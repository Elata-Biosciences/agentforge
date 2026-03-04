export function parseStudioRunIdFromPathname(pathname: string): string | null {
  const m = /^\/runs\/([a-f0-9]{8,})(?:\/(?:dashboard(?:\/.*)?)?)?\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ?? null;
}

export function parseStandaloneRunPageId(pathname: string): string | null {
  const m = /^\/runs\/([a-f0-9]{8,})\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ?? null;
}

export function truncate(s: string, max = 140): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`;
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function toCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : safeStringify(v);
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => toCsvCell((r as any)?.[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replaceAll(/[^a-zA-Z0-9_.-]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

import type { StudioScenarioListItem } from '@/types/index.ts';

export function isBundledExampleScenario(s: StudioScenarioListItem): boolean {
  if (s.group === 'Bundled examples') return true;
  if (s.group === 'Workspace') return false;
  const rel = String(s.relPath ?? '');
  const abs = String(s.scenarioPath ?? '').replaceAll('\\', '/');
  return rel.startsWith('examples/') || abs.includes('/examples/');
}

export function prettyJson(v: unknown, maxChars = 20_000): { text: string; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(v, null, 2);
  } catch {
    text = String(v);
  }
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n... (truncated)`, truncated: true };
}

export function toTabularRows(rows: Array<Record<string, unknown>>): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const cols = new Set<string>();
  for (const r of rows.slice(0, 2000)) {
    for (const k of Object.keys(r)) cols.add(k);
  }
  return { columns: [...cols], rows };
}

export function downloadRowsCsv(filename: string, rawRows: Array<Record<string, unknown>>): void {
  const table = toTabularRows(rawRows);
  if (table.columns.length === 0) return;
  const csv = rowsToCsv(table.rows, table.columns);
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
}

export async function copyRowsCsv(rawRows: Array<Record<string, unknown>>): Promise<void> {
  const table = toTabularRows(rawRows);
  if (table.columns.length === 0) return;
  await copyTextToClipboard(rowsToCsv(table.rows, table.columns));
}
