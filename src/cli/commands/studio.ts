import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { WebSocket, WebSocketServer } from 'ws';
import { parseRunArtifacts } from '../../core/report.js';
import {
  parseActionsPageQuery,
  parseGossipPageQuery,
  parseMemoryPageQuery,
  parseMetricsPageQuery,
  readActionsPage,
  readGossipPage,
  readMemoryPage,
  readMetricsPage,
  summarizeAgentsFromActions,
} from '../../studio/io/pagedArtifacts.js';
import { runMlRequest } from '../../studio/ml/runMl.js';
import { MlRequestSchema } from '../../studio/ml/spec.js';
import { executeQuery } from '../../studio/query/execute.js';
import { QueryRequestSchema } from '../../studio/query/spec.js';
import { executeReportConfig } from '../../studio/report/execute.js';
import { ReportConfigV1Schema } from '../../studio/report/spec.js';
import { listRuns } from '../../studio/runCatalog.js';
import { summarize } from '../../studio/stats/metricSummary.js';
import { linearRegression } from '../../studio/stats/regression.js';
import { output } from '../ui/output.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

function logInfo(msg: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (extra) {
    // eslint-disable-next-line no-console
    console.log(`[studio ${ts}] ${msg}`, extra);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[studio ${ts}] ${msg}`);
}

type StudioRun = {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'failed' | 'stopped';
  startedAt: number;
  pid?: number;
  liveWsUrl?: string;
  outputDir?: string;
  exitCode?: number;
  error?: string;
  dashboardStatus?: 'missing' | 'building' | 'ready' | 'failed';
  dashboardError?: string;
};

const MAX_FULL_ARTIFACT_BYTES = 8 * 1024 * 1024; // 8MB per file; use paged endpoints beyond this.

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function spawnAndCapture(
  command: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.on('error', (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\nspawn_error:${err instanceof Error ? err.message : String(err)}`,
      });
    });
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function tryParseLastJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Keep going; stdout may include logs around the JSON.
  }
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed;
    } catch {
      // continue
    }
  }
  const parsedBalanced = parseLastBalancedJsonObject(trimmed);
  if (parsedBalanced) return parsedBalanced;
  return null;
}

function parseLastBalancedJsonObject(text: string): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let start = -1;
  let best: Record<string, unknown> | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          best = JSON.parse(candidate) as Record<string, unknown>;
        } catch {
          // ignore malformed candidate and continue scanning
        }
        start = -1;
      }
    }
  }
  return best;
}

function extractRunError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const tail = lines.slice(-8).join('\n');
  return tail.slice(0, 4000);
}

async function getFreePort(host: string): Promise<number> {
  const srv = createNetServer();
  await new Promise<void>((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(0, host, () => resolve());
  });
  const addr = srv.address();
  const port = addr && typeof addr !== 'string' ? addr.port : 0;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  if (!port) throw new Error('failed_to_allocate_port');
  return port;
}

function safeJoin(root: string, reqPath: string): string | null {
  const rawPath = reqPath === '/' ? '/index.html' : reqPath;
  const safePath = normalize(rawPath).replaceAll('\\', '/');
  if (!safePath.startsWith('/')) return null;
  if (safePath.includes('..')) return null;
  return join(root, safePath);
}

function toStableId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

type StudioScenario = {
  id: string;
  label: string;
  scenarioPath: string;
  relPath: string;
  group?: string;
  description?: string;
};

function extractFirstDocLine(text: string): string | undefined {
  // Best-effort: read the first /** ... */ and return its first non-empty line.
  const head = text.slice(0, 2500);
  const m = /\/\*\*([\s\S]*?)\*\//.exec(head);
  if (!m) return undefined;
  const body = m[1] ?? '';
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '').trim();
    if (line) return line;
  }
  return undefined;
}

async function listBundledScenarios(packageRoot: string): Promise<StudioScenario[]> {
  const examplesRoot = join(packageRoot, 'examples');
  const workspaceScenarioRoots = [
    join(process.cwd(), 'scenarios'),
    join(process.cwd(), 'sim', 'scenarios'),
  ];
  const out: StudioScenario[] = [];
  const seen = new Set<string>();

  async function walkExamples(absDir: string): Promise<void> {
    let ents: Array<import('node:fs').Dirent> = [];
    try {
      ents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const abs = join(absDir, e.name);
      if (e.isDirectory()) {
        // Keep it simple; examples are small.
        await walkExamples(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name !== 'scenario.ts') continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const relPath = abs.replaceAll('\\', '/').slice(packageRoot.replaceAll('\\', '/').length + 1);
      const relNoPrefix = relPath.replace(/^examples\//, '').replace(/\/scenario\.ts$/, '');
      const parts = relNoPrefix.split('/').filter(Boolean);
      const base = parts[parts.length - 1] ?? relNoPrefix;
      const group = parts.slice(0, -1).join('/');
      const label = group ? `${base} (${group})` : base;
      let description: string | undefined;
      try {
        const content = await readFile(abs, 'utf-8');
        description = extractFirstDocLine(content);
      } catch {
        // ignore
      }
      out.push({
        id: toStableId(relPath),
        label,
        scenarioPath: abs,
        relPath,
        group: 'Bundled examples',
        ...(description ? { description } : {}),
      });
    }
  }

  async function walkWorkspace(absDir: string, root: string): Promise<void> {
    let ents: Array<import('node:fs').Dirent> = [];
    try {
      ents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const abs = join(absDir, e.name);
      if (e.isDirectory()) {
        await walkWorkspace(abs, root);
        continue;
      }
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.ts')) continue;
      if (e.name.endsWith('.d.ts') || e.name.endsWith('.test.ts') || e.name.endsWith('.spec.ts')) {
        continue;
      }
      if (e.name === 'index.ts') continue;
      if (seen.has(abs)) continue;
      seen.add(abs);

      const relPath = abs.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length + 1);
      const relNoExt = relPath.replace(/\.ts$/, '');
      const parts = relNoExt.split('/').filter(Boolean);
      const base = parts[parts.length - 1] ?? relNoExt;
      const group = parts.slice(0, -1).join('/');
      const label = group ? `${base} (${group})` : base;
      let description: string | undefined;
      try {
        const content = await readFile(abs, 'utf-8');
        description = extractFirstDocLine(content);
      } catch {
        // ignore
      }
      out.push({
        id: toStableId(`workspace:${relPath}`),
        label,
        scenarioPath: abs,
        relPath,
        group: 'Workspace',
        ...(description ? { description } : {}),
      });
    }
  }

  await walkExamples(examplesRoot);
  for (const root of workspaceScenarioRoots) {
    await walkWorkspace(root, root);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function getCliSpawn(): Promise<{ command: string; argsPrefix: string[] }> {
  // Work in both dev (`tsx src/cli/index.ts studio`) and installed package (`node dist/cli/index.js`).
  const here = fileURLToPath(import.meta.url);
  // studio.ts lives at src/cli/commands/studio.ts, so ../../../ is the package root.
  const packageRoot = resolve(dirname(here), '../../../');
  const isDev = here.replaceAll('\\', '/').includes('/src/cli/');
  const distCli = join(packageRoot, 'dist', 'cli', 'index.js');
  // Prefer source CLI when Studio itself runs from src/ (avoids running stale dist in dev/test).
  if (!isDev && (await isFile(distCli))) {
    return { command: process.execPath, argsPrefix: [distCli] };
  }
  const tsxBin = join(packageRoot, 'node_modules', '.bin', 'tsx');
  const srcCli = join(packageRoot, 'src', 'cli', 'index.ts');
  return { command: tsxBin, argsPrefix: [srcCli] };
}

export const studioCommand = new Command('studio')
  .description('Launch the local Studio UI (sessions, runs, dashboards, analytics)')
  .option('--host <host>', 'Host/interface to bind', '127.0.0.1')
  .option(
    '--port <port>',
    'Port to bind (0 = random free port)',
    (v) => Number.parseInt(v, 10),
    8790
  )
  .option('--root <dir>', 'Results root (repeatable)', (v, prev: string[]) => [...prev, v], [])
  .option('--live', 'Enable live websocket proxy (optional)')
  .option('--open', 'Open in default browser (macOS: open)')
  .option('--check', 'Start server, self-check /api/health, then exit')
  .action(async (options) => {
    const host = String(options.host);
    const port = Number(options.port);
    const rootsRaw = Array.isArray(options.root) ? (options.root as string[]) : [];
    const roots = (rootsRaw.length > 0 ? rootsRaw : ['sim/results']).map((p) =>
      resolve(process.cwd(), p)
    );
    const enableLive = Boolean(options.live);
    const check = Boolean(options.check);
    const openBrowser = Boolean(options.open);
    const here = fileURLToPath(import.meta.url);
    const packageRoot = resolve(dirname(here), '../../../');

    // Serve the Studio UI bundle (no injected run data).
    // Prefer a locally-built dev bundle if present (useful when iterating on dashboard-app),
    // otherwise fall back to the bundled CLI assets.
    const bundledUiRoot = fileURLToPath(new URL('../assets/dashboard-app/', import.meta.url));
    const devUiRoot = resolve(packageRoot, 'dashboard-app', 'dist');
    let uiRoot = bundledUiRoot;
    try {
      const info = await stat(devUiRoot);
      if (info.isDirectory()) {
        uiRoot = devUiRoot;
      }
    } catch {
      // ignore
    }
    try {
      const info = await stat(uiRoot);
      if (!info.isDirectory()) throw new Error('ui root not a directory');
    } catch {
      output.error(`Missing studio UI assets directory: ${uiRoot}`);
      output.info(`Tried dev path: ${devUiRoot}`);
      output.info(`Tried bundled path: ${bundledUiRoot}`);
      process.exit(2);
    }

    const runs = new Map<string, StudioRun>();
    const uiClients = new Set<import('ws').WebSocket>();
    const dashboardQueue: Array<{ studioRunId: string; runDir: string }> = [];
    let dashboardBuilding = false;

    function broadcast(event: any): void {
      const msg = JSON.stringify({ v: 'v1', ts: Date.now(), ...event });
      for (const ws of uiClients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
          ws.send(msg);
        } catch {
          // ignore
        }
      }
    }

    async function hasDashboard(runDir: string): Promise<boolean> {
      const idx = join(runDir, 'dashboard', 'index.html');
      try {
        const info = await stat(idx);
        if (!info.isFile()) return false;
        const html = await readFile(idx, 'utf-8');
        return html.includes('window.__AF_DATA__') || html.includes('window.__AF_DATA_URL__');
      } catch {
        return false;
      }
    }

    async function isInjectedDashboardIndexHtml(indexPath: string): Promise<boolean> {
      try {
        const info = await stat(indexPath);
        if (!info.isFile()) return false;
        const html = await readFile(indexPath, 'utf-8');
        return html.includes('window.__AF_DATA__') || html.includes('window.__AF_DATA_URL__');
      } catch {
        return false;
      }
    }

    async function commitDashboardBuild(args: { runDir: string; tempDir: string }): Promise<void> {
      // Replace runDir/dashboard atomically so the UI never sees a half-written directory.
      const finalDir = join(args.runDir, 'dashboard');
      await rm(finalDir, { recursive: true, force: true });
      await rename(args.tempDir, finalDir);
    }

    function enqueueDashboardBuild(studioRunId: string, runDir: string): void {
      // Avoid duplicate enqueues for the same runDir.
      if (dashboardQueue.some((x) => x.runDir === runDir)) return;
      dashboardQueue.push({ studioRunId, runDir });
      void drainDashboardQueue();
    }

    async function drainDashboardQueue(): Promise<void> {
      if (dashboardBuilding) return;
      const next = dashboardQueue.shift();
      if (!next) return;
      dashboardBuilding = true;

      const run = runs.get(next.studioRunId) ?? null;
      if (run) {
        run.dashboardStatus = 'building';
        Reflect.deleteProperty(run, 'dashboardError');
        broadcast({ type: 'run_status', payload: run });
      }
      logInfo('generate_dashboard:auto:start', {
        studioRunId: next.studioRunId,
        runDir: next.runDir,
      });

      try {
        const tempDir = join(next.runDir, `dashboard.__building_${Date.now()}`);
        const sp = await getCliSpawn();
        const { code, stdout, stderr } = await spawnAndCapture(sp.command, [
          ...sp.argsPrefix,
          'dashboard',
          next.runDir,
          '--no-git',
          '--output',
          tempDir,
        ]);
        const ok = code === 0 && (await isInjectedDashboardIndexHtml(join(tempDir, 'index.html')));
        if (!ok) {
          const msg = `dashboard_generation_failed code=${code}`;
          if (run) {
            run.dashboardStatus = 'failed';
            run.dashboardError = `${msg}\n${stderr.slice(-1200)}\n${stdout.slice(-1200)}`.trim();
            broadcast({ type: 'run_status', payload: run });
          }
          await rm(tempDir, { recursive: true, force: true });
          logInfo('generate_dashboard:auto:failed', { studioRunId: next.studioRunId, code });
        } else {
          await commitDashboardBuild({ runDir: next.runDir, tempDir });
          if (run) {
            run.dashboardStatus = 'ready';
            Reflect.deleteProperty(run, 'dashboardError');
            broadcast({ type: 'run_status', payload: run });
          }
          logInfo('generate_dashboard:auto:done', { studioRunId: next.studioRunId });
        }
      } catch (err) {
        if (run) {
          run.dashboardStatus = 'failed';
          run.dashboardError = err instanceof Error ? err.message : String(err);
          broadcast({ type: 'run_status', payload: run });
        }
        logInfo('generate_dashboard:auto:error', {
          studioRunId: next.studioRunId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        dashboardBuilding = false;
        // Continue building any queued dashboards.
        void drainDashboardQueue();
      }
    }

    const server = createServer(async (req, res) => {
      const startedAt = Date.now();
      try {
        const url = new URL(req.url ?? '/', `http://${host}:${port || 80}`);
        const path = url.pathname;

        // --- API ---
        if (path === '/api/health') {
          json(res, 200, { ok: true, roots });
          return;
        }

        if (path === '/api/scenarios' && req.method === 'GET') {
          const scenarios = await listBundledScenarios(packageRoot);
          json(res, 200, { ok: true, scenarios });
          return;
        }

        if (path === '/api/runs' && req.method === 'GET') {
          const list = await listRuns(roots);
          json(res, 200, {
            runs: list.map((r) => ({
              id: r.id,
              runDir: r.runDir,
              scenarioName: r.summary.scenarioName,
              runId: r.summary.runId,
              timestamp: r.summary.timestamp,
              success: r.summary.success,
              seed: r.summary.seed,
              ticks: r.summary.ticks,
              durationMs: r.summary.durationMs,
              hasDashboard: r.hasDashboard,
            })),
          });
          return;
        }

        const runPagedMatch =
          /^\/api\/runs\/([a-f0-9]{8,})\/(actions|metrics|agents|memory|gossip)$/.exec(path);
        if (runPagedMatch && req.method === 'GET') {
          const id = runPagedMatch[1]!;
          const action = runPagedMatch[2]!;
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === id);
          if (!entry) {
            json(res, 404, { ok: false, error: 'run_not_found' });
            return;
          }

          if (action === 'actions') {
            const q = parseActionsPageQuery(url);
            const page = await readActionsPage(entry.runDir, q);
            json(res, 200, { ok: true, ...page });
            return;
          }

          if (action === 'metrics') {
            const q = parseMetricsPageQuery(url);
            const page = await readMetricsPage(entry.runDir, q);
            json(res, 200, { ok: true, ...page });
            return;
          }

          if (action === 'agents') {
            const agents = await summarizeAgentsFromActions(entry.runDir);
            json(res, 200, { ok: true, agents });
            return;
          }

          if (action === 'memory') {
            const q = parseMemoryPageQuery(url);
            const page = await readMemoryPage(entry.runDir, q);
            json(res, 200, { ok: true, ...page });
            return;
          }

          if (action === 'gossip') {
            const q = parseGossipPageQuery(url);
            const page = await readGossipPage(entry.runDir, q);
            json(res, 200, { ok: true, ...page });
            return;
          }
        }

        const runIdMatch =
          /^\/api\/runs\/([a-f0-9]{8,})\/(summary|artifacts|file|dashboard|dashboards)$/.exec(path);
        if (runIdMatch) {
          const id = runIdMatch[1]!;
          const action = runIdMatch[2]!;
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === id);
          if (!entry) {
            json(res, 404, { ok: false, error: 'run_not_found' });
            return;
          }

          if (action === 'summary' && req.method === 'GET') {
            json(res, 200, { ok: true, summary: entry.summary, hasDashboard: entry.hasDashboard });
            return;
          }

          if (action === 'artifacts' && req.method === 'GET') {
            const actionsInfo = await stat(join(entry.runDir, 'actions.ndjson')).catch(() => null);
            const metricsInfo = await stat(join(entry.runDir, 'metrics.csv')).catch(() => null);
            if (
              (actionsInfo?.isFile() && actionsInfo.size > MAX_FULL_ARTIFACT_BYTES) ||
              (metricsInfo?.isFile() && metricsInfo.size > MAX_FULL_ARTIFACT_BYTES)
            ) {
              json(res, 413, {
                ok: false,
                error: 'run_too_large_for_full_artifacts',
                hint: 'use_paged_endpoints',
                limits: { maxBytesPerFile: MAX_FULL_ARTIFACT_BYTES },
              });
              return;
            }
            const artifacts = await parseRunArtifacts(entry.runDir);
            let report: unknown = undefined;
            try {
              const raw = (artifacts.config as any)?.scenario?.studio?.report;
              if (raw) {
                const parsed = ReportConfigV1Schema.parse(raw);
                report = await executeReportConfig({
                  config: parsed,
                  runId: String(artifacts.summary.runId ?? 'RUN_ID'),
                  data: {
                    metrics: artifacts.metrics,
                    actions: artifacts.actions,
                    evidence: artifacts.evidence ?? null,
                  },
                });
              }
            } catch (err) {
              report = { v: 'v1', error: err instanceof Error ? err.message : String(err) };
            }
            // Shape matches window.__AF_DATA__ payload.
            json(res, 200, {
              ok: true,
              data: {
                summary: artifacts.summary,
                config: artifacts.config,
                metrics: artifacts.metrics,
                actions: artifacts.actions,
                evidence: artifacts.evidence ?? null,
                ...(report ? { report } : {}),
                hashes: artifacts.hashes,
                gitCommit: null,
              },
            });
            return;
          }

          if (action === 'file' && req.method === 'GET') {
            const rel = url.searchParams.get('path') ?? '';
            const safeRel = normalize(rel).replaceAll('\\', '/');
            if (safeRel.includes('..') || safeRel.startsWith('/')) {
              json(res, 400, { ok: false, error: 'bad_path' });
              return;
            }
            const abs = join(entry.runDir, safeRel);
            const info = await stat(abs);
            if (!info.isFile()) {
              json(res, 404, { ok: false, error: 'not_found' });
              return;
            }
            const body = await readFile(abs);
            res.statusCode = 200;
            res.setHeader(
              'Content-Type',
              CONTENT_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
            );
            res.end(body);
            return;
          }

          if (action === 'dashboard' && req.method === 'POST') {
            // Spawn `forge-sim dashboard <runDir> --no-git` to produce runDir/dashboard/ atomically.
            const sp = await getCliSpawn();
            logInfo('generate_dashboard:start', { runDir: entry.runDir });
            const tempDir = join(entry.runDir, `dashboard.__building_${Date.now()}`);
            const { code, stdout, stderr } = await spawnAndCapture(sp.command, [
              ...sp.argsPrefix,
              'dashboard',
              entry.runDir,
              '--no-git',
              '--output',
              tempDir,
            ]);
            const ok =
              code === 0 && (await isInjectedDashboardIndexHtml(join(tempDir, 'index.html')));
            if (!ok) {
              await rm(tempDir, { recursive: true, force: true });
              logInfo('generate_dashboard:failed', { code, tempDir });
              json(res, 500, {
                ok: false,
                error: 'dashboard_generation_failed',
                code,
                stdout: stdout.slice(-4000),
                stderr: stderr.slice(-4000),
              });
              return;
            }
            await commitDashboardBuild({ runDir: entry.runDir, tempDir });
            logInfo('generate_dashboard:done', { dashDir: join(entry.runDir, 'dashboard') });
            json(res, 200, { ok: true });
            return;
          }

          if (action === 'dashboards' && req.method === 'GET') {
            try {
              const p = join(entry.runDir, 'dashboards.json');
              const raw = await readFile(p, 'utf-8');
              json(res, 200, { ok: true, dashboards: JSON.parse(raw) });
            } catch {
              json(res, 200, { ok: true, dashboards: null });
            }
            return;
          }

          if (action === 'dashboards' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            const p = join(entry.runDir, 'dashboards.json');
            await writeFile(p, `${JSON.stringify(body, null, 2)}\n`);
            json(res, 200, { ok: true });
            return;
          }
        }

        if (path === '/api/runs/start' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const toy = Boolean(body.toy);
          const scenarioPath = typeof body.scenarioPath === 'string' ? body.scenarioPath : null;
          const mode =
            body.mode === 'deterministic' || body.mode === 'exploration' || body.mode === 'replay'
              ? body.mode
              : 'deterministic';
          const seed = typeof body.seed === 'number' ? body.seed : undefined;
          const ticks = typeof body.ticks === 'number' ? body.ticks : undefined;
          const outDir = typeof body.outDir === 'string' ? body.outDir : 'results';
          const captureMemory = body.captureMemory !== false;

          if (!toy && !scenarioPath) {
            json(res, 400, { ok: false, error: 'missing_scenario' });
            return;
          }

          const liveBindHost = '127.0.0.1';
          const livePort = enableLive ? await getFreePort(host) : null;
          const anvilPort = await getFreePort(liveBindHost);
          const liveWsUrl =
            enableLive && typeof livePort === 'number' ? `ws://${liveBindHost}:${livePort}` : null;

          const studioRunId = toStableId(`${Date.now()}-${Math.random()}`);
          const run: StudioRun = {
            id: studioRunId,
            status: 'starting',
            startedAt: Date.now(),
            dashboardStatus: 'missing',
          };
          if (liveWsUrl) {
            run.liveWsUrl = liveWsUrl;
          }
          runs.set(studioRunId, run);
          broadcast({ type: 'run_started', payload: run });
          logInfo('run:start', {
            studioRunId,
            toy,
            scenarioPath,
            mode,
            outDir,
            seed,
            ticks,
            anvilPort,
          });

          const sp = await getCliSpawn();
          const args: string[] = [...sp.argsPrefix, 'run'];
          if (toy) args.push('--toy');
          if (scenarioPath) args.push(scenarioPath);
          args.push('--mode', mode);
          args.push('--out', outDir);
          if (enableLive && typeof livePort === 'number') {
            args.push('--live', '--live-host', liveBindHost, '--live-port', String(livePort));
          }
          args.push('--json');
          if (captureMemory) args.push('--capture-memory');
          if (seed !== undefined) args.push('--seed', String(seed));
          if (ticks !== undefined) args.push('--ticks', String(ticks));

          const child = spawn(sp.command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              ANVIL_PORT: String(anvilPort),
            },
          });
          if (typeof child.pid === 'number') {
            run.pid = child.pid;
          }
          run.status = 'running';
          broadcast({ type: 'run_status', payload: run });

          // Proxy live events into Studio WS so UI doesn't need to connect to multiple origins.
          let liveProxy: WebSocket | null = null;
          let proxyClosed = false;

          child.on('error', (err) => {
            proxyClosed = true;
            try {
              liveProxy?.close();
            } catch {
              // ignore
            }
            run.status = 'failed';
            run.error = `spawn_failed:${err instanceof Error ? err.message : String(err)}`;
            broadcast({ type: 'run_status', payload: run });
            logInfo('run:end', {
              studioRunId,
              status: run.status,
              exitCode: run.exitCode ?? null,
              outputDir: run.outputDir ?? null,
              error: run.error ?? null,
            });
          });
          async function connectLiveProxyWithRetry(wsUrl: string): Promise<void> {
            // The run process starts its live server very early, but in practice it can take a beat.
            // If we attempt to connect too fast and get ECONNREFUSED, we should retry.
            for (let attempt = 0; attempt < 25 && !proxyClosed; attempt += 1) {
              try {
                const ws = await new Promise<WebSocket>((resolve, reject) => {
                  const sock = new WebSocket(wsUrl);
                  const onOpen = () => {
                    sock.off('error', onErr);
                    resolve(sock);
                  };
                  const onErr = (err: unknown) => {
                    sock.off('open', onOpen);
                    try {
                      sock.close();
                    } catch {
                      // ignore
                    }
                    reject(err);
                  };
                  sock.once('open', onOpen);
                  sock.once('error', onErr);
                });
                liveProxy = ws;
                ws.on('message', (buf) => {
                  try {
                    const event = JSON.parse(String(buf));
                    broadcast({ type: 'live_event', payload: { studioRunId, event } });
                  } catch {
                    // ignore
                  }
                });
                ws.on('error', () => {
                  // best-effort; the dashboard can always connect directly to liveWsUrl
                });
                return;
              } catch {
                await delay(Math.min(1000, 80 + attempt * 60));
              }
            }
          }
          if (enableLive && liveWsUrl) {
            void connectLiveProxyWithRetry(liveWsUrl);
          }

          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (d) => {
            stdout += String(d);
          });
          child.stderr?.on('data', (d) => {
            stderr += String(d);
          });
          child.on('exit', (code) => {
            proxyClosed = true;
            try {
              liveProxy?.close();
            } catch {
              // ignore
            }
            if (typeof code === 'number') {
              run.exitCode = code;
            }
            try {
              const parsed = tryParseLastJsonObject(stdout);
              if (parsed && typeof parsed.outputDir === 'string') run.outputDir = parsed.outputDir;
              if (parsed && parsed.success === false && typeof parsed.error === 'string')
                run.error = parsed.error;
              if (parsed && parsed.success === true) {
                run.status = 'finished';
              } else if (parsed && parsed.success === false) {
                run.status = 'failed';
              } else {
                run.status = code === 0 ? 'finished' : 'failed';
              }
              if (run.status === 'failed' && !run.error) {
                const fallbackError = extractRunError(stderr) ?? extractRunError(stdout);
                if (fallbackError) run.error = fallbackError;
              }
            } catch {
              run.status = code === 0 ? 'finished' : 'failed';
              if (run.status === 'failed') {
                const fallbackError = extractRunError(stderr) ?? extractRunError(stdout);
                if (fallbackError) run.error = fallbackError;
              }
            }
            broadcast({ type: 'run_status', payload: run });
            logInfo('run:end', {
              studioRunId,
              status: run.status,
              exitCode: run.exitCode ?? null,
              outputDir: run.outputDir ?? null,
              error: run.error ?? null,
            });

            // Auto-generate the dashboard for Studio-started runs so users can immediately open it.
            // This is intentionally serialized to avoid CPU spikes when multiple runs end together.
            if (run.outputDir) {
              void (async () => {
                const already = await hasDashboard(run.outputDir!);
                if (already) {
                  run.dashboardStatus = 'ready';
                  broadcast({ type: 'run_status', payload: run });
                  return;
                }
                enqueueDashboardBuild(studioRunId, run.outputDir!);
              })();
            }
          });

          json(
            res,
            200,
            liveWsUrl ? { ok: true, studioRunId, liveWsUrl } : { ok: true, studioRunId }
          );
          return;
        }

        if (path === '/api/query' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const parsed = QueryRequestSchema.safeParse(body);
          if (!parsed.success) {
            json(res, 400, { ok: false, error: 'invalid_query', details: parsed.error.flatten() });
            return;
          }
          const { runId, table } = parsed.data;
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === runId);
          if (!entry) {
            json(res, 404, { ok: false, error: 'run_not_found' });
            return;
          }
          const artifacts = await parseRunArtifacts(entry.runDir);
          const result = executeQuery(parsed.data, {
            metrics: artifacts.metrics,
            actions: artifacts.actions,
            evidence: artifacts.evidence ?? null,
          });
          json(res, 200, { ok: true, table, result });
          return;
        }

        if (path === '/api/stats/regression' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const runId = typeof body.runId === 'string' ? body.runId : '';
          const xField = typeof body.xField === 'string' ? body.xField : '';
          const yField = typeof body.yField === 'string' ? body.yField : '';
          const table =
            body.table === 'metrics' || body.table === 'actions' || body.table === 'evidence'
              ? body.table
              : 'metrics';
          if (!runId || !xField || !yField) {
            json(res, 400, { ok: false, error: 'missing_fields' });
            return;
          }
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === runId);
          if (!entry) {
            json(res, 404, { ok: false, error: 'run_not_found' });
            return;
          }
          const artifacts = await parseRunArtifacts(entry.runDir);
          const rows =
            table === 'metrics'
              ? (artifacts.metrics as any[])
              : table === 'actions'
                ? (artifacts.actions as any[])
                : ((artifacts.evidence?.records ?? []) as any[]);
          const points: Array<{ x: number; y: number }> = [];
          for (const r of rows) {
            const x = Number((r as any)[xField]);
            const y = Number((r as any)[yField]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            points.push({ x, y });
          }
          const fit = linearRegression(points);
          json(res, 200, { ok: true, fit });
          return;
        }

        if (path === '/api/stats/metric-summary' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const runIds = Array.isArray(body.runIds) ? body.runIds.map(String) : [];
          const metricKey = typeof body.metricKey === 'string' ? body.metricKey : '';
          if (runIds.length === 0 || !metricKey) {
            json(res, 400, { ok: false, error: 'missing_fields' });
            return;
          }
          const list = await listRuns(roots);
          const rows: Array<{
            runId: string;
            scenarioName: string;
            timestamp: string;
            summary: any | null;
          }> = [];
          for (const id of runIds.slice(0, 50)) {
            const entry = list.find((r) => r.id === id);
            if (!entry) {
              rows.push({ runId: id, scenarioName: '-', timestamp: '-', summary: null });
              continue;
            }
            const artifacts = await parseRunArtifacts(entry.runDir);
            const values: number[] = [];
            for (const s of artifacts.metrics ?? []) {
              const v = Number((s as any)[metricKey]);
              if (!Number.isFinite(v)) continue;
              values.push(v);
            }
            rows.push({
              runId: id,
              scenarioName: entry.summary.scenarioName,
              timestamp: entry.summary.timestamp,
              summary: summarize(values),
            });
          }
          json(res, 200, { ok: true, metricKey, rows });
          return;
        }

        if (path === '/api/ml' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const parsed = MlRequestSchema.safeParse(body);
          if (!parsed.success) {
            json(res, 400, {
              ok: false,
              error: 'invalid_ml_request',
              details: parsed.error.flatten(),
            });
            return;
          }
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === parsed.data.runId);
          if (!entry) {
            json(res, 404, { ok: false, error: 'run_not_found' });
            return;
          }
          const artifacts = await parseRunArtifacts(entry.runDir);
          let datasets:
            | Record<
                string,
                {
                  columns: Array<{ name: string; type: string }>;
                  rows: Array<Record<string, unknown>>;
                }
              >
            | undefined;
          if (parsed.data.dataset) {
            const reportRaw = (artifacts as any)?.config?.scenario?.studio?.report;
            if (reportRaw) {
              try {
                const reportCfg = ReportConfigV1Schema.parse(reportRaw);
                const reportOut = await executeReportConfig({
                  config: reportCfg,
                  runId: String((artifacts as any)?.summary?.runId ?? parsed.data.runId),
                  data: {
                    metrics: artifacts.metrics,
                    actions: artifacts.actions,
                    evidence: artifacts.evidence ?? null,
                  },
                });
                datasets = reportOut.datasets as any;
              } catch {
                // keep undefined and let runMlRequest return missing_dataset
              }
            }
          }
          const result = await runMlRequest(
            parsed.data,
            {
              metrics: artifacts.metrics,
              actions: artifacts.actions,
              evidence: artifacts.evidence ?? null,
            },
            datasets
          );
          json(res, 200, result);
          return;
        }

        // --- Serve run dashboards under /runs/:id/dashboard/* ---
        const dashMatch = /^\/runs\/([a-f0-9]{8,})\/dashboard(\/.*)?$/.exec(path);
        if (dashMatch) {
          const id = dashMatch[1]!;
          const list = await listRuns(roots);
          const entry = list.find((r) => r.id === id);
          if (!entry) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          const dashRoot = join(entry.runDir, 'dashboard');
          if (
            !(await stat(dashRoot)
              .then((s) => s.isDirectory())
              .catch(() => false))
          ) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          const subRaw = dashMatch[2] ?? '/';
          // Directory URLs should serve index.html so links like `/runs/<id>/dashboard/` work.
          const sub =
            subRaw === '/' || subRaw === ''
              ? '/index.html'
              : subRaw.endsWith('/')
                ? `${subRaw}index.html`
                : subRaw;
          const abs = safeJoin(dashRoot, sub) ?? '';
          try {
            const info = await stat(abs);
            if (!info.isFile()) {
              res.statusCode = 404;
              res.end('Not Found');
              return;
            }
            const body = await readFile(abs);
            res.setHeader(
              'Content-Type',
              CONTENT_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
            );
            res.statusCode = 200;
            res.end(body);
            return;
          } catch {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
        }

        // --- Docs API ---
        if (path === '/api/docs' && req.method === 'GET') {
          const docsDir = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '..',
            '..',
            '..',
            'docs'
          );
          const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
          const docs: Array<{ title: string; path: string }> = [];

          const rootFiles = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
          for (const f of rootFiles) {
            try {
              const content = await readFile(join(projectRoot, f), 'utf8');
              const headingMatch = content.match(/^#\s+(.+)/m);
              docs.push({ title: headingMatch?.[1] ?? f.replace('.md', ''), path: f });
            } catch {
              /* skip missing files */
            }
          }

          try {
            const files = await readdir(docsDir);
            for (const f of files.filter((n) => n.endsWith('.md')).sort()) {
              try {
                const content = await readFile(join(docsDir, f), 'utf8');
                const headingMatch = content.match(/^#\s+(.+)/m);
                docs.push({ title: headingMatch?.[1] ?? f.replace('.md', ''), path: `docs/${f}` });
              } catch {
                /* skip */
              }
            }
          } catch {
            /* docs dir may not exist */
          }

          json(res, 200, { ok: true, docs });
          return;
        }

        const docsPathMatch = /^\/api\/docs\/(.+)$/.exec(path);
        if (docsPathMatch?.[1] && req.method === 'GET') {
          const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
          const requestedPath = decodeURIComponent(docsPathMatch[1]);
          const abs = safeJoin(projectRoot, `/${requestedPath}`);
          if (!abs || !requestedPath.endsWith('.md')) {
            json(res, 400, { ok: false, error: 'invalid_doc_path' });
            return;
          }
          try {
            const content = await readFile(abs, 'utf8');
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.statusCode = 200;
            res.end(content);
          } catch {
            json(res, 404, { ok: false, error: 'doc_not_found' });
          }
          return;
        }

        // --- UI static files ---
        // Vite UI build uses relative asset paths (`./assets/*`, `./vite.svg`).
        // On routes like /runs/<id>, browsers resolve those to /runs/assets/* and /runs/vite.svg.
        // Normalize those requests back to UI-root asset paths.
        let uiPath = path;
        const runsAsset = /^\/runs\/assets\/(.+)$/.exec(path);
        if (runsAsset?.[1]) {
          uiPath = `/assets/${runsAsset[1]}`;
        } else if (path === '/runs/vite.svg') {
          uiPath = '/vite.svg';
        }

        const abs = safeJoin(uiRoot, uiPath);
        if (!abs) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        try {
          const info = await stat(abs);
          if (info.isFile()) {
            const body = await readFile(abs);
            res.statusCode = 200;
            res.setHeader(
              'Content-Type',
              CONTENT_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
            );
            res.end(body);
            return;
          }
        } catch {
          // fall through to SPA fallback
        }

        // SPA fallback
        const idx = join(uiRoot, 'index.html');
        const idxBody = await readFile(idx);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(idxBody);
      } catch (err) {
        json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        const ms = Date.now() - startedAt;
        const method = String(req.method ?? 'GET');
        // eslint-disable-next-line no-console
        console.log(
          `[studio] ${method} ${(req.url ?? '/').slice(0, 160)} ${res.statusCode} ${ms}ms`
        );
      }
    });

    const wss = new WebSocketServer({ server, path: '/api/ws' });
    wss.on('connection', (ws) => {
      uiClients.add(ws);
      ws.on('close', () => uiClients.delete(ws));
      ws.send(JSON.stringify({ v: 'v1', ts: Date.now(), type: 'hello', payload: { roots } }));
      ws.send(
        JSON.stringify({ v: 'v1', ts: Date.now(), type: 'runs', payload: [...runs.values()] })
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, host, () => resolve());
    });

    const addr = server.address();
    const actualPort = addr && typeof addr !== 'string' ? addr.port : port;
    const url = `http://${host}:${actualPort}/`;
    output.success(`Studio running: ${url}`);
    output.info(`Roots: ${roots.join(', ')}`);
    output.newline();
    logInfo('server:listening', { url, roots });

    if (openBrowser) {
      try {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      } catch {
        // best-effort
      }
    }

    if (check) {
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(`${url}api/health`, (resp) => {
          const ok = resp.statusCode === 200;
          resp.resume();
          resp.on('end', () => (ok ? resolve() : reject(new Error(`HTTP ${resp.statusCode}`))));
        });
        req.on('error', reject);
        req.end();
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exit(0);
    }

    // Keep process alive.
  });
