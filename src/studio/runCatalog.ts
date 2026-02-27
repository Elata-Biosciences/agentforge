import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunSummary } from '../core/report.js';

export type RunCatalogEntry = {
  /** Stable ID derived from absolute runDir */
  id: string;
  /** Absolute path to run directory */
  runDir: string;
  summary: RunSummary;
  hasDashboard: boolean;
};

function toId(runDirAbs: string): string {
  return createHash('sha256').update(runDirAbs).digest('hex').slice(0, 16);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function hasFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readSummary(runDirAbs: string): Promise<RunSummary | null> {
  const p = join(runDirAbs, 'summary.json');
  if (!(await hasFile(p))) return null;
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw) as RunSummary;
}

async function collectCandidateRunDirs(absRoot: string): Promise<string[]> {
  const out: string[] = [];
  let kids: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    kids = await readdir(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const dirent of kids) {
    if (!dirent.isDirectory()) continue;
    const child = join(absRoot, dirent.name);
    out.push(child);

    // Support common "scenario/run/summary.json" layout by checking one level deeper.
    let grandkids: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      grandkids = await readdir(child, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const g of grandkids) {
      if (!g.isDirectory()) continue;
      out.push(join(child, g.name));
    }
  }

  return out;
}

/**
 * V1 catalog: scan direct children of roots and include directories that contain summary.json.
 * This keeps it fast and matches AgentForge's default `outDir/runId/` layout.
 */
export async function listRuns(roots: string[]): Promise<RunCatalogEntry[]> {
  const entries: RunCatalogEntry[] = [];
  for (const root of roots) {
    const absRoot = resolve(root);
    if (!(await isDir(absRoot))) continue;
    const candidates = await collectCandidateRunDirs(absRoot);
    for (const runDir of candidates) {
      const summary = await readSummary(runDir);
      if (!summary) continue;
      const dashDir = join(runDir, 'dashboard');
      const hasDashboard = await isDir(dashDir);
      entries.push({ id: toId(runDir), runDir, summary, hasDashboard });
    }
  }

  // Newest first (summary.timestamp is ISO string)
  entries.sort((a, b) => b.summary.timestamp.localeCompare(a.summary.timestamp));
  return entries;
}

export function findRunById(list: RunCatalogEntry[], id: string): RunCatalogEntry | null {
  return list.find((r) => r.id === id) ?? null;
}
