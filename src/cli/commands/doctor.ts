import { exec } from 'node:child_process';
import { constants } from 'node:fs';
import { access, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { output } from '../ui/output.js';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  version?: string;
}

/**
 * Doctor command - diagnose environment
 */
export const doctorCommand = new Command('doctor')
  .description('Check environment and dependencies')
  .option('--json', 'Output results as JSON')
  .option('--check-llm', 'Check for common LLM API keys (optional)')
  .action(async (options) => {
    const results: CheckResult[] = [];
    const jsonMode = options.json === true;

    if (!jsonMode) {
      output.header('AgentForge Environment Check');
      output.newline();
    }

    // Check Node.js version
    results.push(await checkNodeVersion(jsonMode));

    // Check npm/pnpm
    results.push(await checkPackageManager(jsonMode));

    // Check Foundry (optional)
    results.push(await checkFoundry(jsonMode));

    // Check Anvil (optional)
    results.push(await checkAnvil(jsonMode));

    // Check filesystem write access (temp)
    results.push(await checkFilesystem(jsonMode));

    // Check sim/results write access
    results.push(await checkSimResults(jsonMode));

    if (options.checkLlm) {
      results.push(checkLlmEnv(jsonMode));
    }

    // Compute summary
    const errors = results.filter((r) => r.status === 'error' && !isOptional(r.name));
    const warnings = results.filter((r) => r.status === 'warn');
    const allPassed = errors.length === 0;

    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            results,
            allPassed,
            requiredErrors: errors.length,
            warnings: warnings.length,
          },
          null,
          2
        )
      );
    } else {
      output.newline();

      // Print summary
      if (allPassed) {
        output.success('All required checks passed!');
        if (warnings.length > 0) {
          output.warn(`${warnings.length} optional component(s) not found`);
        }
        output.newline();
        output.info('Ready to run: npx forge-sim run --toy');
      } else {
        output.error(`${errors.length} required check(s) failed`);
        output.newline();
        output.info('Fix the errors above before running simulations');
      }
    }

    // Exit with appropriate code
    process.exit(allPassed ? 0 : 1);
  });

async function checkNodeVersion(silent = false): Promise<CheckResult> {
  const version = process.version;
  const major = Number.parseInt(version.slice(1).split('.')[0] ?? '0', 10);

  if (major >= 18) {
    if (!silent) output.check('Node.js', 'ok', `${version} (>= 18.0.0 required)`);
    return { name: 'Node.js', status: 'ok', message: 'Version OK', version };
  }

  if (!silent) output.check('Node.js', 'error', `${version} (>= 18.0.0 required)`);
  return {
    name: 'Node.js',
    status: 'error',
    message: 'Version too old, need >= 18.0.0',
    version,
  };
}

async function checkPackageManager(silent = false): Promise<CheckResult> {
  // Check for pnpm first
  try {
    const { stdout } = await execAsync('pnpm --version');
    const version = stdout.trim();
    if (!silent) output.check('pnpm', 'ok', `v${version}`);
    return { name: 'pnpm', status: 'ok', message: 'Found', version };
  } catch {
    // pnpm not found, check npm
  }

  try {
    const { stdout } = await execAsync('npm --version');
    const version = stdout.trim();
    if (!silent) output.check('npm', 'ok', `v${version}`);
    return { name: 'npm', status: 'ok', message: 'Found', version };
  } catch {
    if (!silent) output.check('Package manager', 'error', 'Neither pnpm nor npm found');
    return {
      name: 'Package manager',
      status: 'error',
      message: 'Neither pnpm nor npm found',
    };
  }
}

async function checkFoundry(silent = false): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('forge --version');
    const version = stdout.trim().split('\n')[0] ?? 'unknown';
    if (!silent) output.check('Foundry (forge)', 'ok', version);
    return { name: 'Foundry', status: 'ok', message: 'Found', version };
  } catch {
    if (!silent) output.check('Foundry (forge)', 'warn', 'Not found (optional for Phase 1)');
    return {
      name: 'Foundry',
      status: 'warn',
      message: 'Not found (optional)',
    };
  }
}

async function checkAnvil(silent = false): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('anvil --version');
    const version = stdout.trim().split('\n')[0] ?? 'unknown';
    if (!silent) output.check('Anvil', 'ok', version);
    return { name: 'Anvil', status: 'ok', message: 'Found', version };
  } catch {
    if (!silent) output.check('Anvil', 'warn', 'Not found (optional for Phase 1)');
    return {
      name: 'Anvil',
      status: 'warn',
      message: 'Not found (optional)',
    };
  }
}

async function checkFilesystem(silent = false): Promise<CheckResult> {
  const testFile = join(tmpdir(), `agentforge-test-${Date.now()}.tmp`);

  try {
    await writeFile(testFile, 'test');
    await access(testFile, constants.R_OK | constants.W_OK);
    await unlink(testFile);

    if (!silent) output.check('Temp directory', 'ok', 'Write access OK');
    return { name: 'Temp directory', status: 'ok', message: 'Write access OK' };
  } catch {
    if (!silent) output.check('Temp directory', 'error', 'Cannot write to temp directory');
    return {
      name: 'Temp directory',
      status: 'error',
      message: 'Cannot write to temp directory',
    };
  }
}

async function checkSimResults(silent = false): Promise<CheckResult> {
  const { mkdir } = await import('node:fs/promises');
  const resultsDir = join(process.cwd(), 'sim', 'results');
  const testFile = join(resultsDir, `.agentforge-test-${Date.now()}.tmp`);

  try {
    // Try to create the directory if it doesn't exist
    await mkdir(resultsDir, { recursive: true });

    // Test write access
    await writeFile(testFile, 'test');
    await unlink(testFile);

    if (!silent) output.check('sim/results', 'ok', 'Write access OK');
    return { name: 'sim/results', status: 'ok', message: 'Write access OK' };
  } catch {
    if (!silent) output.check('sim/results', 'warn', 'Cannot write to sim/results (will use temp)');
    return {
      name: 'sim/results',
      status: 'warn',
      message: 'Cannot write to sim/results',
    };
  }
}

function isOptional(name: string): boolean {
  return name === 'Foundry' || name === 'Anvil';
}

function checkLlmEnv(silent = false): CheckResult {
  const present =
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY) ||
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.OPENAI_COMPAT_API_KEY);

  if (present) {
    if (!silent) output.check('LLM env', 'ok', 'At least one provider key found');
    return { name: 'LLM env', status: 'ok', message: 'At least one provider key found' };
  }

  if (!silent) {
    output.check(
      'LLM env',
      'warn',
      'No provider keys found (exploration runs will fallback or fail)'
    );
  }
  return {
    name: 'LLM env',
    status: 'warn',
    message: 'No provider keys found (exploration runs will fallback or fail)',
  };
}
