import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { getGitCommit, parseRunArtifacts } from '../../core/report.js';
import { readActionsPage, readMetricsPage } from '../../studio/io/pagedArtifacts.js';
import { executeReportConfig } from '../../studio/report/execute.js';
import { ReportConfigV1Schema } from '../../studio/report/spec.js';
import { output } from '../ui/output.js';

const HUGE_ARTIFACT_BYTES = 25 * 1024 * 1024; // 25MB per file; beyond this we sample instead of loading full.

/**
 * Dashboard command - generate a static dashboard/ folder for a run
 */
export const dashboardCommand = new Command('dashboard')
  .description('Generate a static dashboard (React+Vite) from run artifacts')
  .argument('<runDir>', 'Path to the run directory containing artifacts')
  .option('-o, --output <path>', 'Output directory (default: dashboard/ in run directory)')
  .option('--no-git', 'Skip git commit lookup')
  .action(async (runDir, options) => {
    try {
      const runPath = isAbsolute(runDir) ? runDir : resolve(process.cwd(), runDir);
      output.info(`Parsing artifacts from: ${runPath}`);
      output.newline();

      const summaryPath = join(runPath, 'summary.json');
      const configPath = join(runPath, 'config_resolved.json');
      const metricsPath = join(runPath, 'metrics.csv');
      const actionsPath = join(runPath, 'actions.ndjson');
      const evidencePath = join(runPath, 'evidence.json');

      const actionsInfo = await stat(actionsPath).catch(() => null);
      const metricsInfo = await stat(metricsPath).catch(() => null);
      const isHuge =
        (actionsInfo?.isFile() && actionsInfo.size > HUGE_ARTIFACT_BYTES) ||
        (metricsInfo?.isFile() && metricsInfo.size > HUGE_ARTIFACT_BYTES);

      let artifacts: any;
      let payload: any;
      if (!isHuge) {
        artifacts = await parseRunArtifacts(runPath);
      } else {
        output.info(
          `Large run detected; sampling artifacts (actions/metrics over ${Math.round(HUGE_ARTIFACT_BYTES / 1024 / 1024)}MB)`
        );
        const [summaryContent, configContent, evidenceContent] = await Promise.all([
          readFile(summaryPath, 'utf-8'),
          readFile(configPath, 'utf-8'),
          readOptionalFile(evidencePath, 2 * 1024 * 1024),
        ]);
        const summary = JSON.parse(summaryContent);
        const config = JSON.parse(configContent);

        const metricsPage = await readMetricsPage(runPath, { offset: 0, limit: 5000 });
        const actionsPage = await readActionsPage(runPath, { offset: 0, limit: 1000 });
        const evidence = evidenceContent ? JSON.parse(evidenceContent) : null;

        const hashes = {
          summary: computeHash(summaryContent),
          config: computeHash(configContent),
          metrics: await computeFileHashStream(metricsPath),
          actions: await computeFileHashStream(actionsPath),
          ...(evidenceContent ? { evidence: computeHash(evidenceContent) } : {}),
        };

        artifacts = {
          summary,
          config,
          metrics: metricsPage.rows,
          actions: actionsPage.rows,
          evidence,
          hashes,
        };
        payload = {
          summary,
          config,
          metrics: metricsPage.rows,
          actions: actionsPage.rows,
          evidence,
          hashes,
          gitCommit: null,
          meta: {
            largeRunWarning:
              'This run is large; dashboard shows a sampled subset. Use Studio paged APIs for full inspection.',
          },
        };
      }

      const gitCommit = options.git !== false ? await getGitCommit(runPath) : null;

      const outDir = options.output
        ? isAbsolute(options.output)
          ? options.output
          : resolve(process.cwd(), options.output)
        : join(runPath, 'dashboard');

      await mkdir(outDir, { recursive: true });

      // Copy the built dashboard app bundle into the output directory.
      const assetsDirUrl = new URL('../assets/dashboard-app/', import.meta.url);
      const assetsDir = fileURLToPath(assetsDirUrl);
      await cp(assetsDir, outDir, { recursive: true });

      // Build an index.html that injects run data to avoid file:// fetch/CORS issues.
      const manifestPath = join(outDir, '.vite', 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<
        string,
        { file: string; css?: string[] }
      >;
      const entry = manifest['index.html'];
      if (!entry?.file) {
        throw new Error('Dashboard bundle missing manifest entry: index.html');
      }
      // Guardrail: if the manifest and assets are out of sync, the page loads blank.
      // This commonly happens if `.vite/manifest.json` wasn't copied when syncing UI assets.
      await stat(join(outDir, entry.file)).catch(() => {
        throw new Error(
          `dashboard_bundle_out_of_sync:missing_entry_file:${entry.file} (rebuild/sync dashboard-app assets)`
        );
      });

      if (!payload) {
        payload = {
          summary: artifacts.summary,
          config: artifacts.config,
          metrics: artifacts.metrics,
          actions: artifacts.actions,
          evidence: artifacts.evidence ?? null,
          hashes: artifacts.hashes,
          gitCommit: gitCommit ?? null,
        };
      } else {
        payload.gitCommit = gitCommit ?? null;
      }

      // Optional report dashboard execution (config-driven).
      try {
        const reportRaw = (payload as any)?.config?.scenario?.studio?.report;
        if (reportRaw) {
          const parsed = ReportConfigV1Schema.parse(reportRaw);
          const report = await executeReportConfig({
            config: parsed,
            runId: String((payload as any)?.summary?.runId ?? 'RUN_ID'),
            data: {
              metrics: (payload as any).metrics ?? [],
              actions: (payload as any).actions ?? [],
              evidence: (payload as any).evidence ?? null,
            },
          });
          (payload as any).report = report;
        }
      } catch (err) {
        (payload as any).report = {
          v: 'v1',
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const payloadJson = safeJson(payload);
      const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
      const MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5MB: avoid gigantic index.html for large runs

      const cssLinks = (entry.css ?? [])
        .map((href) => `<link rel="stylesheet" href="./${href}" />`)
        .join('\n');

      let dataScript = '';
      if (payloadBytes <= MAX_INLINE_BYTES) {
        dataScript = `window.__AF_DATA__ = ${payloadJson};`;
      } else {
        const dataPath = join(outDir, 'data.json');
        await writeFile(dataPath, `${payloadJson}\n`);
        dataScript = `window.__AF_DATA_URL__ = './data.json';`;
        output.info(
          `Large run detected (${Math.round(payloadBytes / 1024 / 1024)}MB); wrote data.json`
        );
      }

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentForge Dashboard: ${escapeHtml(artifacts.summary.scenarioName)}</title>
    ${cssLinks}
  </head>
  <body>
    <div id="root"></div>
    <script>
      ${dataScript}
    </script>
    <script type="module" src="./${entry.file}"></script>
  </body>
</html>
`;

      const outPath = join(outDir, 'index.html');
      await writeFile(outPath, html);
      output.success(`Dashboard written to: ${outPath}`);
      output.newline();
      output.info('Tip: open dashboard/index.html in your browser');
      process.exit(0);
    } catch (error) {
      output.error(
        `Failed to generate dashboard: ${error instanceof Error ? error.message : error}`
      );
      process.exit(2);
    }
  });

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function computeFileHashStream(filePath: string): Promise<string> {
  const h = createHash('sha256');
  const stream = createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (buf) => h.update(buf));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return h.digest('hex');
}

async function readOptionalFile(path: string, maxBytes: number): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    if (info.size > maxBytes) return null;
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

function escapeHtml(input: string): string {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
