#!/usr/bin/env node
/**
 * Assembles a RunData JSON fixture from example simulation results
 * so the full dashboard can be previewed during development.
 *
 * Usage: node scripts/build-dev-fixture.mjs
 * Output: public/dev-data.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const resultsDir = join(root, '..', 'examples', 'basic-simulation', 'results', 'basic-simulation-2026-02-17T16-19-36-227Z');

const summary = JSON.parse(readFileSync(join(resultsDir, 'summary.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(resultsDir, 'config_resolved.json'), 'utf8'));

// Parse CSV
const csvLines = readFileSync(join(resultsDir, 'metrics.csv'), 'utf8').trim().split('\n');
const headers = csvLines[0].split(',');
const metrics = csvLines.slice(1).map((line) => {
  const vals = line.split(',');
  const row = {};
  headers.forEach((h, i) => {
    const v = vals[i];
    row[h] = v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  });
  return row;
});

// Parse NDJSON
const actionsRaw = readFileSync(join(resultsDir, 'actions.ndjson'), 'utf8').trim().split('\n');
const actions = actionsRaw.map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

// Construct RunData
const runData = {
  summary: {
    runId: summary.runId,
    scenarioName: summary.scenarioName,
    seed: summary.seed,
    ticks: summary.ticks,
    durationMs: summary.durationMs,
    success: summary.success,
    finalMetrics: summary.finalMetrics,
    agentStats: summary.agentStats,
  },
  config,
  metrics,
  actions,
  gossip: [],
  report: null,
  evidence: null,
  hashes: { summary: 'dev-fixture', config: 'dev-fixture', metrics: 'dev-fixture', actions: 'dev-fixture' },
  gitCommit: null,
};

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'dev-data.json'), JSON.stringify(runData));
console.log(`Wrote public/dev-data.json (${(JSON.stringify(runData).length / 1024).toFixed(1)} KB)`);
