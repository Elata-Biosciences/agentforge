import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { SimulationEngine } from '../../core/engine.js';
import { createLogger } from '../../core/logging.js';
import { loadScenario } from '../../core/scenario.js';
import type { RunResult, Scenario } from '../../core/types.js';
import { createToyScenario } from '../../toy/toyScenario.js';
import { output } from '../ui/output.js';

/**
 * Statistics for a metric across all runs
 */
interface SweepMetricStats {
  metric: string;
  min: number;
  max: number;
  mean: number;
  p05: number;
  p50: number;
  p95: number;
  stddev: number;
}

/**
 * Compute percentile from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const safeIndex = Math.max(0, Math.min(index, sortedValues.length - 1));
  return sortedValues[safeIndex] ?? 0;
}

/**
 * Compute standard deviation
 */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Parse seed range (e.g., "1..50" or "1,2,3,4,5")
 */
function parseSeedRange(seedArg: string): number[] {
  // Check for range format: start..end
  const rangeMatch = seedArg.match(/^(\d+)\.\.(\d+)$/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    const seeds: number[] = [];
    for (let i = start; i <= end; i++) {
      seeds.push(i);
    }
    return seeds;
  }

  // Check for comma-separated list
  if (seedArg.includes(',')) {
    return seedArg.split(',').map((s) => Number.parseInt(s.trim(), 10));
  }

  // Single number - interpret as count starting from 1
  const count = Number.parseInt(seedArg, 10);
  if (!Number.isNaN(count) && count > 0) {
    const seeds: number[] = [];
    for (let i = 1; i <= count; i++) {
      seeds.push(i);
    }
    return seeds;
  }

  throw new Error(`Invalid seed format: ${seedArg}. Use "1..50", "1,2,3", or a count like "25"`);
}

/**
 * Sweep command - run scenario with multiple seeds
 */
export const sweepCommand = new Command('sweep')
  .description('Run a scenario with multiple seeds and generate aggregate statistics')
  .argument('[scenario]', 'Path to scenario file (.ts)')
  .option('--toy', 'Run the built-in toy scenario')
  .option('--seeds <range>', 'Seed range (e.g., "1..50", "1,2,3", or count "25")', '1..25')
  .option('-t, --ticks <number>', 'Override number of ticks', Number.parseInt)
  .option('-o, --out <path>', 'Output directory for sweep results', 'sim/results/sweep')
  .option('--ci', 'CI mode (no colors, strict exit codes)')
  .option('-v, --verbose', 'Verbose output')
  .option('--parallel <n>', 'Number of parallel runs (default: 1)', '1')
  .option('--json', 'Output results as JSON')
  .action(async (scenarioPath, options) => {
    const ci = options.ci || process.env.CI === 'true';
    const jsonOutput = options.json;
    const suppressOutput = jsonOutput;

    try {
      // Parse seed range
      const seeds = parseSeedRange(options.seeds);

      if (!suppressOutput) {
        output.header(`Sweep: ${seeds.length} runs`);
        output.newline();
      }

      // Load scenario
      let baseScenario: Scenario;

      if (options.toy || !scenarioPath) {
        baseScenario = createToyScenario({ ticks: options.ticks });
        if (!suppressOutput) {
          output.info('Using toy scenario');
        }
      } else {
        const fullPath = isAbsolute(scenarioPath)
          ? scenarioPath
          : resolve(process.cwd(), scenarioPath);
        const fileUrl = pathToFileURL(fullPath).href;
        baseScenario = await loadScenario(fileUrl);
        if (!suppressOutput) {
          output.info(`Loaded scenario: ${baseScenario.name}`);
        }
      }

      // Override ticks if specified
      const ticks = options.ticks ?? baseScenario.ticks;

      // Create output directory
      const outDir = isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sweepDir = join(outDir, `${baseScenario.name}-${timestamp}`);
      await mkdir(sweepDir, { recursive: true });

      if (!suppressOutput) {
        output.config('Seeds', `${seeds.length} (${seeds[0]}..${seeds[seeds.length - 1]})`);
        output.config('Ticks', String(ticks));
        output.config('Output', sweepDir);
        output.newline();
      }

      // Run simulations
      const logger = createLogger({
        level: options.verbose ? 'debug' : 'warn',
        ci,
      });

      const results: RunResult[] = [];
      const parallelCount = Math.max(1, Number.parseInt(options.parallel, 10) || 1);

      if (!suppressOutput) {
        output.info(`Running ${seeds.length} simulations (${parallelCount} parallel)...`);
        output.newline();
      }

      // Run in batches
      for (let i = 0; i < seeds.length; i += parallelCount) {
        const batchSeeds = seeds.slice(i, i + parallelCount);
        const batchPromises = batchSeeds.map(async (seed) => {
          const engine = new SimulationEngine({ logger });
          const result = await engine.run(baseScenario, {
            seed,
            ticks,
            outDir: sweepDir,
            ci: true,
            runIdSuffix: `seed-${seed}`,
          });
          return result;
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (!suppressOutput) {
          const progress = Math.min(i + parallelCount, seeds.length);
          output.info(`Progress: ${progress}/${seeds.length} runs completed`);
        }
      }

      // Compute aggregate statistics
      const allMetricNames = new Set<string>();
      for (const result of results) {
        for (const key of Object.keys(result.finalMetrics)) {
          allMetricNames.add(key);
        }
      }

      const metricStats: SweepMetricStats[] = [];
      for (const metric of allMetricNames) {
        const values = results
          .map((r) => {
            const v = r.finalMetrics[metric];
            if (typeof v === 'number') return v;
            if (typeof v === 'string') return Number.parseFloat(v);
            if (typeof v === 'bigint') return Number(v);
            return Number.NaN;
          })
          .filter((v) => !Number.isNaN(v));

        if (values.length === 0) continue;

        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);

        metricStats.push({
          metric,
          min: sorted[0] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
          mean: sum / values.length,
          p05: percentile(sorted, 5),
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          stddev: stddev(values),
        });
      }

      // Find worst runs (by failure count or lowest success rate)
      const runsBySuccessRate = [...results].sort((a, b) => {
        const rateA =
          a.agentStats.reduce((sum, s) => sum + s.actionsSucceeded, 0) /
          Math.max(
            1,
            a.agentStats.reduce((sum, s) => sum + s.actionsAttempted, 0)
          );
        const rateB =
          b.agentStats.reduce((sum, s) => sum + s.actionsSucceeded, 0) /
          Math.max(
            1,
            b.agentStats.reduce((sum, s) => sum + s.actionsAttempted, 0)
          );
        return rateA - rateB;
      });
      const worstRuns = runsBySuccessRate.slice(0, 3);

      // Generate summary CSV
      const csvLines: string[] = [];
      const csvHeader = ['seed', 'success', 'durationMs', ...allMetricNames].join(',');
      csvLines.push(csvHeader);

      for (const result of results) {
        const values = [
          result.seed,
          result.success ? 1 : 0,
          result.durationMs,
          ...Array.from(allMetricNames).map((m) => {
            const v = result.finalMetrics[m];
            if (v === undefined) return '';
            return String(v);
          }),
        ];
        csvLines.push(values.join(','));
      }

      await writeFile(join(sweepDir, 'summary.csv'), csvLines.join('\n'));

      // Generate markdown report
      const reportLines: string[] = [];
      reportLines.push(`# Sweep Report: ${baseScenario.name}`);
      reportLines.push('');
      reportLines.push('## Configuration');
      reportLines.push('');
      reportLines.push('| Property | Value |');
      reportLines.push('|----------|-------|');
      reportLines.push(`| Scenario | ${baseScenario.name} |`);
      reportLines.push(`| Seeds | ${seeds.length} (${seeds[0]}..${seeds[seeds.length - 1]}) |`);
      reportLines.push(`| Ticks | ${ticks} |`);
      reportLines.push(`| Timestamp | ${new Date().toISOString()} |`);
      reportLines.push('');

      // Success summary
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;
      reportLines.push('## Results Summary');
      reportLines.push('');
      reportLines.push(`- **Total Runs**: ${results.length}`);
      reportLines.push(
        `- **Passed**: ${successCount} (${((successCount / results.length) * 100).toFixed(1)}%)`
      );
      reportLines.push(
        `- **Failed**: ${failureCount} (${((failureCount / results.length) * 100).toFixed(1)}%)`
      );
      reportLines.push('');

      // Metric statistics
      reportLines.push('## Metric Statistics');
      reportLines.push('');
      reportLines.push('| Metric | Min | P05 | P50 | P95 | Max | Mean | StdDev |');
      reportLines.push('|--------|-----|-----|-----|-----|-----|------|--------|');
      for (const stat of metricStats) {
        reportLines.push(
          `| ${stat.metric} | ${stat.min.toFixed(2)} | ${stat.p05.toFixed(2)} | ${stat.p50.toFixed(2)} | ${stat.p95.toFixed(2)} | ${stat.max.toFixed(2)} | ${stat.mean.toFixed(2)} | ${stat.stddev.toFixed(2)} |`
        );
      }
      reportLines.push('');

      // Tail risk (worst runs)
      reportLines.push('## Tail Risk Analysis');
      reportLines.push('');
      reportLines.push('Worst 3 runs by agent success rate:');
      reportLines.push('');
      for (const [i, run] of worstRuns.entries()) {
        const totalAttempted = run.agentStats.reduce((sum, s) => sum + s.actionsAttempted, 0);
        const totalSucceeded = run.agentStats.reduce((sum, s) => sum + s.actionsSucceeded, 0);
        const rate = totalAttempted > 0 ? (totalSucceeded / totalAttempted) * 100 : 100;

        reportLines.push(`### ${i + 1}. Seed ${run.seed}`);
        reportLines.push('');
        reportLines.push(`- Success Rate: ${rate.toFixed(1)}%`);
        reportLines.push(`- Status: ${run.success ? 'PASSED' : 'FAILED'}`);
        if (run.failedAssertions.length > 0) {
          reportLines.push('- Failed Assertions:');
          for (const failure of run.failedAssertions) {
            reportLines.push(`  - ${failure.message}`);
          }
        }
        reportLines.push('');
      }

      await writeFile(join(sweepDir, 'report.md'), reportLines.join('\n'));

      if (jsonOutput) {
        const jsonResult = {
          scenario: baseScenario.name,
          seeds: seeds.length,
          ticks,
          successCount,
          failureCount,
          metricStats,
          worstRuns: worstRuns.map((r) => ({
            seed: r.seed,
            success: r.success,
            failedAssertions: r.failedAssertions,
          })),
          outputDir: sweepDir,
        };
        console.log(JSON.stringify(jsonResult, null, 2));
      } else {
        output.newline();
        output.success(`Sweep complete: ${results.length} runs`);
        output.newline();

        output.subheader('Summary');
        output.stat('Passed', `${successCount}/${results.length}`);
        output.stat('Failed', `${failureCount}/${results.length}`);
        output.newline();

        output.info(`Results written to: ${sweepDir}`);
        output.bullet('summary.csv - Per-seed KPIs');
        output.bullet('report.md - Aggregate statistics');
      }

      // Exit with failure if any runs failed
      process.exit(failureCount > 0 ? 1 : 0);
    } catch (error) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      } else {
        output.error(`Sweep failed: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(2);
    }
  });
