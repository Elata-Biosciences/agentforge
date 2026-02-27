import { constants, access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { runLlmInit } from '../llmInit/initLlm.js';
import { output } from '../ui/output.js';

/**
 * Init command - scaffold simulation folders
 */
export const initCommand = new Command('init')
  .description('Initialize simulation folder structure')
  .argument('[path]', 'Target directory (default: current directory)')
  .option('-f, --force', 'Overwrite existing files')
  .option('--wizard', 'Scaffold a richer non-interactive starter kit')
  .option('--llm', 'Generate contract-aware scaffolding from Foundry artifacts')
  .option('--llm-model <id>', 'LLM model id (for generated scenario)', 'gpt-4o-mini')
  .option('--llm-dry', 'Skip live LLM calls (generate scaffolding only)')
  .action(async (targetPath, options) => {
    const targetDir = resolve(targetPath ?? process.cwd());
    const simDir = join(targetDir, 'sim');

    output.header('Initializing AgentForge');
    output.info(`Target: ${targetDir}`);
    output.newline();

    try {
      // Create directory structure
      const directories = [
        'scenarios',
        'agents',
        'packs',
        'metrics',
        'results',
        'generated',
        'scripts',
      ];

      for (const dir of directories) {
        const dirPath = join(simDir, dir);
        await mkdir(dirPath, { recursive: true });
        output.created(`sim/${dir}/`);
      }

      // Create README
      const readmePath = join(simDir, 'README.md');
      if (options.force || !(await fileExists(readmePath))) {
        await writeFile(readmePath, getReadmeContent());
        output.created('sim/README.md');
      } else {
        output.skipped('sim/README.md (already exists)');
      }

      // Create example scenario
      const examplePath = join(simDir, 'scenarios', 'example.ts');
      if (options.force || !(await fileExists(examplePath))) {
        await writeFile(examplePath, getExampleScenarioContent());
        output.created('sim/scenarios/example.ts');
      } else {
        output.skipped('sim/scenarios/example.ts (already exists)');
      }

      if (options.wizard) {
        // Very lightweight "wizard": validate basic repo shape and emit more templates.
        const foundryToml = join(targetDir, 'foundry.toml');
        if (await fileExists(foundryToml)) {
          output.info('Foundry project detected (foundry.toml present)');
        } else {
          output.warn('No foundry.toml detected (this is fine for toy sims)');
        }

        const baselinePath = join(simDir, 'scenarios', 'baseline.ts');
        if (options.force || !(await fileExists(baselinePath))) {
          await writeFile(baselinePath, getBaselineScenarioContent());
          output.created('sim/scenarios/baseline.ts');
        } else {
          output.skipped('sim/scenarios/baseline.ts (already exists)');
        }

        const reliabilityScriptPath = join(simDir, 'scripts', 'run-reliability.ts');
        if (options.force || !(await fileExists(reliabilityScriptPath))) {
          await writeFile(reliabilityScriptPath, getReliabilityScriptContent());
          output.created('sim/scripts/run-reliability.ts');
        } else {
          output.skipped('sim/scripts/run-reliability.ts (already exists)');
        }
      }

      if (options.llm) {
        const envKey =
          process.env.OPENAI_API_KEY ??
          process.env.OPENAI_KEY ??
          process.env.OPENROUTER_API_KEY ??
          process.env.ANTHROPIC_API_KEY ??
          process.env.GEMINI_API_KEY ??
          null;
        const requestedDry = options.llmDry === true;
        const missingKey = !requestedDry && !envKey;
        const effectiveDry = requestedDry || missingKey;

        output.newline();
        output.header('init --llm');
        await runLlmInit({
          targetDir,
          simDir,
          force: Boolean(options.force),
          dry: effectiveDry,
          model: String(options.llmModel),
        });

        if (missingKey) {
          output.newline();
          output.error(
            'No LLM API key found in env. Re-run with --llm-dry, or set OPENAI_API_KEY (or other provider key).'
          );
          process.exit(2);
        }
      }

      // Create a Makefile with common commands (optional, but very convenient)
      const makefilePath = join(simDir, 'Makefile');
      if (options.force || !(await fileExists(makefilePath))) {
        await writeFile(makefilePath, getMakefileContent());
        output.created('sim/Makefile');
      } else {
        output.skipped('sim/Makefile (already exists)');
      }

      // Create an env example (users can copy to their own env manager)
      const envExamplePath = join(simDir, '.env.example');
      if (options.force || !(await fileExists(envExamplePath))) {
        await writeFile(envExamplePath, getEnvExampleContent());
        output.created('sim/.env.example');
      } else {
        output.skipped('sim/.env.example (already exists)');
      }

      // Update .gitignore
      await updateGitignore(targetDir);

      output.newline();
      output.success('AgentForge initialized successfully!');
      output.newline();
      output.info('Next steps:');
      output.step(
        '1',
        options.wizard
          ? 'Start with sim/scenarios/baseline.ts (golden path) or sim/scenarios/example.ts'
          : 'Edit sim/scenarios/example.ts to customize your scenario'
      );
      output.step(
        '2',
        options.wizard
          ? 'Run: forge-sim run sim/scenarios/baseline.ts --mode exploration'
          : 'Run: forge-sim run sim/scenarios/example.ts'
      );
      output.step('3', 'Generate a dashboard: forge-sim dashboard sim/results/<run>');
    } catch (error) {
      output.error(`Failed to initialize: ${error instanceof Error ? error.message : error}`);
      process.exit(2);
    }
  });

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function updateGitignore(targetDir: string): Promise<void> {
  const gitignorePath = join(targetDir, '.gitignore');
  const linesToAdd = ['sim/results/', 'sim/generated/', 'sim/dashboard/', '*.lcov'];

  try {
    let content = '';
    try {
      content = await readFile(gitignorePath, 'utf-8');
    } catch {
      // File doesn't exist, we'll create it
    }

    const existingLines = content.split('\n');
    const newLines: string[] = [];

    for (const line of linesToAdd) {
      if (!existingLines.some((l) => l.trim() === line)) {
        newLines.push(line);
      }
    }

    if (newLines.length > 0) {
      const addition = `\n# AgentForge simulation outputs\n${newLines.join('\n')}\n`;
      await writeFile(gitignorePath, content + addition);
      output.updated('.gitignore');
    } else {
      output.skipped('.gitignore (already configured)');
    }
  } catch (error) {
    output.warn(`Could not update .gitignore: ${error instanceof Error ? error.message : error}`);
  }
}

function getReadmeContent(): string {
  return `# Simulation Directory

This directory contains AgentForge simulation configurations.

## Structure

- \`scenarios/\` - Simulation scenario definitions
- \`agents/\` - Custom agent implementations
- \`packs/\` - Protocol-specific packs
- \`metrics/\` - Metric definitions
- \`results/\` - Simulation output (gitignored)
- \`generated/\` - Generated types (gitignored)

## Quick Start

1. Run the example scenario:
   \`\`\`bash
   forge-sim run sim/scenarios/example.ts
   \`\`\`

2. Run modes (recommended):
   \`\`\`bash
   forge-sim run sim/scenarios/example.ts --mode deterministic
   forge-sim run sim/scenarios/example.ts --mode exploration
   forge-sim run sim/scenarios/example.ts --mode replay --replay-bundle sim/results/<run>/replay_bundle.json
   \`\`\`

3. Or run the built-in toy scenario:
   \`\`\`bash
   forge-sim run --toy
   \`\`\`

## Results

Each simulation run produces:
- \`summary.json\` - Run metadata and final metrics
- \`metrics.csv\` - Time-series data
- \`actions.ndjson\` - All agent actions
- \`config_resolved.json\` - Resolved configuration

## Documentation

See https://github.com/Elata-Biosciences/agentforge for full documentation.
`;
}

function getExampleScenarioContent(): string {
  return `/**
 * Example simulation scenario
 *
 * This scenario demonstrates the basic structure of an AgentForge simulation.
 * Customize it for your protocol.
 */

import { defineScenario } from '@elata-biosciences/agentforge';
import {
  ToyPack,
  RandomTraderAgent,
  MomentumAgent,
  HolderAgent,
} from '@elata-biosciences/agentforge/toy';

export default defineScenario({
  name: 'example',
  seed: 42,
  ticks: 50,
  tickSeconds: 3600, // 1 hour per tick

  pack: new ToyPack({
    assets: [
      { name: 'TOKEN', initialPrice: 100, volatility: 0.05 },
    ],
    initialCash: 10000,
  }),

  agents: [
    {
      type: RandomTraderAgent,
      count: 5,
      params: {
        buyWeight: 0.3,
        sellWeight: 0.3,
        holdWeight: 0.4,
      },
    },
    {
      type: MomentumAgent,
      count: 2,
      params: {
        threshold: 2,
        tradePercent: 0.1,
      },
    },
    {
      type: HolderAgent,
      count: 3,
    },
  ],

  metrics: {
    sampleEveryTicks: 1,
  },

  assertions: [
    { type: 'gt', metric: 'totalVolume', value: 0 },
  ],
});
`;
}

function getBaselineScenarioContent(): string {
  return `/**
 * Baseline "golden path" scenario
 *
 * Recommended workflow:
 * 1) exploration:  forge-sim run sim/scenarios/baseline.ts --mode exploration
 * 2) replay:       forge-sim run sim/scenarios/baseline.ts --mode replay --replay-bundle sim/results/<run>/replay_bundle.json
 * 3) dashboard:    forge-sim dashboard sim/results/<run>
 *
 * Tip: live stream (best-effort):
 *   forge-sim run sim/scenarios/baseline.ts --mode exploration --live --live-port 8787
 *   open sim/results/<run>/dashboard/index.html?ws=ws://localhost:8787
 */

import { defineScenario } from '@elata-biosciences/agentforge';
import { HolderAgent, MomentumAgent, RandomTraderAgent, ToyPack } from '@elata-biosciences/agentforge/toy';

export default defineScenario({
  name: 'baseline',
  seed: 42,
  ticks: 100,
  tickSeconds: 3600,

  pack: new ToyPack({
    assets: [{ name: 'TOKEN', initialPrice: 100, volatility: 0.05 }],
    initialCash: 10000,
  }),

  agents: [
    { type: RandomTraderAgent, count: 6, params: { buyWeight: 0.3, sellWeight: 0.3, holdWeight: 0.4 } },
    { type: MomentumAgent, count: 2, params: { threshold: 2, tradePercent: 0.1 } },
    { type: HolderAgent, count: 2 },
  ],

  metrics: { sampleEveryTicks: 1 },
  assertions: [{ type: 'gt', metric: 'totalVolume', value: 0 }],
});
`;
}

function getReliabilityScriptContent(): string {
  return `/**
 * Reliability runner (local dev helper)
 *
 * This script is intentionally simple: it shells out to the CLI so:
 * - it mirrors what end users do
 * - it's easy for LLMs to run/modify
 *
 * Usage:
 *   pnpm -s tsx sim/scripts/run-reliability.ts
 */

import { execSync } from 'node:child_process';

const scenario = process.env.SCENARIO ?? 'sim/scenarios/baseline.ts';
const seeds = process.env.SEEDS ?? '1..10';
const ticks = process.env.TICKS ?? '';

const cmd = [
  'forge-sim',
  'sweep',
  scenario,
  '--seeds',
  seeds,
  ...(ticks ? ['--ticks', ticks] : []),
  '--ci',
].join(' ');

// eslint-disable-next-line no-console
console.log(cmd);
execSync(cmd, { stdio: 'inherit' });
`;
}

function getMakefileContent(): string {
  return `# AgentForge convenience targets
# Usage:
#   make deterministic
#   make exploration
#   make replay REPLAY_BUNDLE=sim/results/<run>/replay_bundle.json

SCENARIO ?= sim/scenarios/example.ts
REPLAY_BUNDLE ?=

.PHONY: deterministic exploration replay report sweep doctor

deterministic:
\tforge-sim run $(SCENARIO) --mode deterministic

exploration:
\tforge-sim run $(SCENARIO) --mode exploration

replay:
\tforge-sim run $(SCENARIO) --mode replay --replay-bundle $(REPLAY_BUNDLE)

report:
\tforge-sim report sim/results

sweep:
\tforge-sim sweep $(SCENARIO) --seeds 1..10

doctor:
\tforge-sim doctor
`;
}

function getEnvExampleContent(): string {
  return `# LLM provider keys (optional unless using --mode exploration)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-latest

OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash

# OpenAI-compatible endpoints (DeepSeek/Kimi/Ollama/vLLM gateways)
OPENAI_COMPAT_BASE_URL=
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=
`;
}
