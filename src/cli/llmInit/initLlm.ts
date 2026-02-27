import type { Stats } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { output } from '../ui/output.js';

type AbiItem = {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: Array<{ name?: string; type?: string }>;
  outputs?: Array<{ name?: string; type?: string }>;
};

type DiscoveredContract = {
  contractName: string;
  artifactPath: string;
  abi: AbiItem[];
};

export async function runLlmInit(options: {
  targetDir: string;
  simDir: string;
  force: boolean;
  dry: boolean;
  model: string;
}): Promise<void> {
  const outDir = join(options.targetDir, 'out');
  const contracts = await discoverContractsFromOut(outDir);

  const genDir = join(options.simDir, 'generated', 'llm-init');
  await mkdir(genDir, { recursive: true });

  const contractsJsonPath = join(genDir, 'contracts.json');
  if (options.force || !(await fileExists(contractsJsonPath))) {
    await writeFile(contractsJsonPath, `${JSON.stringify({ contracts }, null, 2)}\n`);
    output.created(pathRel(options.targetDir, contractsJsonPath));
  } else {
    output.skipped(`${pathRel(options.targetDir, contractsJsonPath)} (already exists)`);
  }

  const contractsTsPath = join(genDir, 'contracts.ts');
  if (options.force || !(await fileExists(contractsTsPath))) {
    await writeFile(contractsTsPath, `${getContractsTsContent(contracts)}\n`);
    output.created(pathRel(options.targetDir, contractsTsPath));
  } else {
    output.skipped(`${pathRel(options.targetDir, contractsTsPath)} (already exists)`);
  }

  const packTsPath = join(genDir, 'pack.ts');
  if (options.force || !(await fileExists(packTsPath))) {
    await writeFile(packTsPath, `${getPackTsContent()}\n`);
    output.created(pathRel(options.targetDir, packTsPath));
  } else {
    output.skipped(`${pathRel(options.targetDir, packTsPath)} (already exists)`);
  }

  const scenarioTsPath = join(options.simDir, 'scenarios', 'llm.ts');
  if (options.force || !(await fileExists(scenarioTsPath))) {
    await writeFile(
      scenarioTsPath,
      `${getScenarioTsContent({ model: options.model, dry: options.dry })}\n`
    );
    output.created(pathRel(options.targetDir, scenarioTsPath));
  } else {
    output.skipped(`${pathRel(options.targetDir, scenarioTsPath)} (already exists)`);
  }

  const rationalePath = join(genDir, 'generated-rationale.md');
  if (options.force || !(await fileExists(rationalePath))) {
    await writeFile(
      rationalePath,
      `${getRationaleContent({
        contracts,
        model: options.model,
        dry: options.dry,
        outDir: pathRel(options.targetDir, outDir),
      })}\n`
    );
    output.created(pathRel(options.targetDir, rationalePath));
  } else {
    output.skipped(`${pathRel(options.targetDir, rationalePath)} (already exists)`);
  }

  if (!options.dry) {
    output.warn(
      'LLM generation is not yet wired to provider calls in init --llm. Generated scaffolding is contract-aware, but prompts/agents are TODO.'
    );
  }

  if (contracts.length === 0) {
    output.warn(
      'No Foundry artifacts detected in ./out. Run `forge build` first, or ensure this is a Foundry repo.'
    );
  } else {
    output.info(`Discovered ${contracts.length} contracts from out/`);
  }
}

async function discoverContractsFromOut(outDir: string): Promise<DiscoveredContract[]> {
  const result: DiscoveredContract[] = [];
  const entries = await safeReadDir(outDir);
  for (const entry of entries) {
    await walk(resolve(outDir, entry), outDir, result);
  }
  return result.sort((a, b) => a.contractName.localeCompare(b.contractName));
}

async function walk(absPath: string, outDir: string, result: DiscoveredContract[]): Promise<void> {
  const { stat, readdir } = await import('node:fs/promises');
  let info: Stats;
  try {
    info = await stat(absPath);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    const entries = await readdir(absPath);
    for (const e of entries) {
      await walk(join(absPath, e), outDir, result);
    }
    return;
  }
  if (!absPath.endsWith('.json')) return;

  try {
    const content = await readFile(absPath, 'utf-8');
    const parsed = JSON.parse(content) as any;
    const abi = Array.isArray(parsed.abi) ? (parsed.abi as AbiItem[]) : null;
    const contractName =
      typeof parsed.contractName === 'string'
        ? parsed.contractName
        : typeof parsed.contract_name === 'string'
          ? parsed.contract_name
          : null;
    if (!abi || !contractName) return;

    result.push({
      contractName,
      artifactPath: relative(outDir, absPath),
      abi,
    });
  } catch {
    // Ignore invalid JSON artifacts
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  const { access, constants } = await import('node:fs/promises');
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathRel(root: string, abs: string): string {
  const rel = relative(root, abs);
  return rel.startsWith('..') ? abs : rel;
}

function getContractsTsContent(contracts: DiscoveredContract[]): string {
  const rows = contracts.map((c) => {
    const alias = c.contractName;
    const address = '0x0000000000000000000000000000000000000000';
    return {
      alias,
      address,
      artifactPath: c.artifactPath.replaceAll('\\', '/'),
      abi: c.abi,
    };
  });
  return `/* eslint-disable */
/**
 * Contract surface extracted from Foundry artifacts in out/
 *
 * Edit this file:
 * - set addresses to the deployed contract addresses
 * - optionally remove contracts you don't want allowlisted
 */

export const CONTRACTS = ${JSON.stringify(rows, null, 2)} as const;
`;
}

function getPackTsContent(): string {
  return `/* eslint-disable */
/**
 * Generated Viem+Anvil pack (starter skeleton)
 *
 * This pack implements the action names AgentForge already validates:
 * - ContractRead
 * - ContractCall (exploration/replay)
 * - arbitrary_tx (used by ArbitraryExecutor)
 *
 * TODO: wire this into your Foundry deployment flow (forge script/broadcast parsing).
 */

import { spawnAnvil, stopAnvil, createViemPublicClient, createAgentWallet, waitForTransaction } from '@elata-biosciences/agentforge/adapters';
import type { Action, ActionResult, Pack, WorldState } from '@elata-biosciences/agentforge';
import { CONTRACTS } from './contracts.js';

type ContractRow = (typeof CONTRACTS)[number];

export class GeneratedAnvilPack implements Pack {
  public readonly name = 'GeneratedAnvilPack';
  private anvil: Awaited<ReturnType<typeof spawnAnvil>> | null = null;
  private client = createViemPublicClient({ rpcUrl: 'http://127.0.0.1:8545' });

  private contractsByAlias = new Map<string, ContractRow>();

  constructor(private readonly options: { spawn?: boolean } = {}) {
    for (const c of CONTRACTS) this.contractsByAlias.set(c.alias, c);
  }

  async initialize(): Promise<void> {
    if (this.options.spawn) {
      this.anvil = await spawnAnvil();
      this.client = createViemPublicClient({ rpcUrl: this.anvil.rpcUrl });
    }
  }

  getWorldState(): WorldState {
    return {
      timestamp: Date.now(),
      pack: this.name,
      contracts: CONTRACTS.map((c) => ({ alias: c.alias, address: c.address })),
    };
  }

  getMetrics(): Record<string, number | string | bigint> {
    return {};
  }

  async callRpc(method: string, params: unknown[]): Promise<unknown> {
    return await this.client.request({ method: method as any, params: params as any });
  }

  async executeAction(action: Action, agentId: string): Promise<ActionResult> {
    try {
      if (action.name === 'ContractRead') {
        const alias = String(action.params.contract);
        const fn = String(action.params.function);
        const args = Array.isArray(action.params.args) ? action.params.args : [];
        const c = this.contractsByAlias.get(alias);
        if (!c) return { ok: false, error: 'unknown_contract_alias' };
        const value = await this.client.readContract({
          address: c.address as any,
          abi: c.abi as any,
          functionName: fn as any,
          args: args as any,
        });
        return { ok: true, events: [{ name: 'ContractReadResult', args: { alias, fn, value } }] };
      }

      if (action.name === 'ContractCall' || action.name === 'arbitrary_tx') {
        const wallet = createAgentWallet({
          rpcUrl: (this.anvil?.rpcUrl ?? 'http://127.0.0.1:8545'),
          agentId,
        });

        if (action.name === 'arbitrary_tx') {
          const to = String(action.params.to);
          const data = String(action.params.data);
          const value = String(action.params.value ?? '0x0');
          const hash = await wallet.sendTransaction({ to: to as any, data: data as any, value: BigInt(value) });
          await waitForTransaction(this.client, hash);
          return { ok: true, txHash: String(hash) };
        }

        const alias = String(action.params.contract);
        const fn = String(action.params.function);
        const args = Array.isArray(action.params.args) ? action.params.args : [];
        const valueHex = action.params.value !== undefined ? String(action.params.value) : undefined;
        const c = this.contractsByAlias.get(alias);
        if (!c) return { ok: false, error: 'unknown_contract_alias' };

        const hash = await wallet.writeContract({
          address: c.address as any,
          abi: c.abi as any,
          functionName: fn as any,
          args: args as any,
          ...(valueHex ? { value: BigInt(valueHex) } : {}),
        });
        await waitForTransaction(this.client, hash);
        return { ok: true, txHash: String(hash) };
      }

      return { ok: false, error: 'action_not_supported' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  async cleanup(): Promise<void> {
    if (this.anvil) {
      await stopAnvil(this.anvil);
      this.anvil = null;
    }
  }
}
`;
}

function getScenarioTsContent(options: { model: string; dry: boolean }): string {
  return `/**
 * init --llm generated scenario (starter)
 *
 * This is intentionally conservative:
 * - It wires a generated Anvil pack with your contract ABIs
 * - It does NOT auto-generate agent prompts yet (TODO)
 *
 * Next:
 * - fill in deployed contract addresses in sim/generated/llm-init/contracts.ts
 * - run in exploration mode once your pack is correct
 */

import { defineScenario } from '@elata-biosciences/agentforge';
import { LlmPolicyAgent } from '@elata-biosciences/agentforge';
import { GeneratedAnvilPack } from '../generated/llm-init/pack.js';

export default defineScenario({
  name: 'llm-init',
  seed: 1,
  ticks: 25,
  tickSeconds: 12,

  pack: new GeneratedAnvilPack({ spawn: true }),

  agents: [
    {
      type: LlmPolicyAgent,
      count: 1,
      params: {
        provider: 'openai',
        model: '${options.model}',
        systemPrompt:
          'You are a smart contract red-team analyst. Find and prove vulnerabilities with evidence.',
      },
    },
  ],
});
`;
}

function getRationaleContent(options: {
  contracts: DiscoveredContract[];
  model: string;
  dry: boolean;
  outDir: string;
}): string {
  const lines: string[] = [];
  lines.push('# init --llm generated rationale');
  lines.push('');
  lines.push(`- model: \`${options.model}\``);
  lines.push(`- dry: \`${String(options.dry)}\``);
  lines.push(`- artifacts: \`${options.outDir}\``);
  lines.push('');
  lines.push('## Discovered contracts');
  lines.push('');
  if (options.contracts.length === 0) {
    lines.push('- (none)');
  } else {
    for (const c of options.contracts.slice(0, 50)) {
      const fns = c.abi.filter((x) => x.type === 'function' && typeof x.name === 'string');
      lines.push(`- \`${c.contractName}\` (${fns.length} functions) - \`${c.artifactPath}\``);
    }
  }
  lines.push('');
  lines.push('## Next steps');
  lines.push('');
  lines.push('- Run `forge build` (if out/ is empty)');
  lines.push('- Fill in addresses in `sim/generated/llm-init/contracts.ts`');
  lines.push('- Run: `forge-sim run sim/scenarios/llm.ts --mode exploration`');
  lines.push('- Generate a dashboard: `forge-sim dashboard sim/results/<run>`');
  return lines.join('\\n');
}
