import { readFile, writeFile } from 'node:fs/promises';
import { ReplayBundleSchema } from '../core/llmSchemas.js';
import type {
  ReplayActionRecord,
  ReplayArbitraryExecutionRecord,
  ReplayBundle,
  ReplayMessageRecord,
  ReplayQueryRecord,
} from '../core/types.js';

export class ReplayRecorder {
  private readonly actions: ReplayActionRecord[] = [];
  private readonly messages: ReplayMessageRecord[] = [];
  private readonly queries: ReplayQueryRecord[] = [];
  private readonly arbitraryExecutions: ReplayArbitraryExecutionRecord[] = [];

  recordAction(record: ReplayActionRecord): void {
    this.actions.push(record);
  }

  recordMessage(record: ReplayMessageRecord): void {
    this.messages.push(record);
  }

  recordQuery(record: ReplayQueryRecord): void {
    this.queries.push(record);
  }

  recordArbitraryExecution(record: ReplayArbitraryExecutionRecord): void {
    this.arbitraryExecutions.push(record);
  }

  build(scenarioName: string, seed: number, mode: ReplayBundle['mode']): ReplayBundle {
    return {
      version: 'v2',
      scenarioName,
      seed,
      mode,
      actions: this.actions,
      messages: this.messages,
      queries: this.queries,
      arbitraryExecutions: this.arbitraryExecutions,
    };
  }
}

export async function saveReplayBundle(path: string, bundle: ReplayBundle): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(bundle, (_k, value) => (typeof value === 'bigint' ? value.toString() : value), 2)}\n`
  );
}

export async function loadReplayBundle(path: string): Promise<ReplayBundle> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = ReplayBundleSchema.parse(parsed);
  return {
    ...validated,
    version: validated.version as 'v1' | 'v2',
    actions: validated.actions.map((entry) => {
      const resultPart = entry.result
        ? {
            result: {
              ok: entry.result.ok,
              ...(entry.result.error ? { error: entry.result.error } : {}),
            },
          }
        : {};
      const metricsPart = entry.metricsSnapshot ? { metricsSnapshot: entry.metricsSnapshot } : {};

      if (!entry.action) {
        return {
          tick: entry.tick,
          agentId: entry.agentId,
          action: null,
          ...resultPart,
          ...metricsPart,
        };
      }
      const actionBase = {
        id: entry.action.id,
        name: entry.action.name,
        params: entry.action.params,
      };
      return {
        tick: entry.tick,
        agentId: entry.agentId,
        action:
          entry.action.metadata !== undefined
            ? { ...actionBase, metadata: entry.action.metadata }
            : actionBase,
        ...resultPart,
        ...metricsPart,
      };
    }),
    messages: validated.messages as ReplayMessageRecord[],
    queries: validated.queries as ReplayQueryRecord[],
    arbitraryExecutions: validated.arbitraryExecutions as ReplayArbitraryExecutionRecord[],
  };
}

export function selectReplayAction(
  bundle: ReplayBundle,
  tick: number,
  agentId: string
): ReplayActionRecord | undefined {
  return bundle.actions.find((item) => item.tick === tick && item.agentId === agentId);
}
