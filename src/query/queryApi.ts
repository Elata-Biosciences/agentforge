import type {
  QueryBudget,
  QueryEndpoint,
  QueryRequest,
  QueryResult,
  WorldState,
} from '../core/types.js';
import { QueryBudgetManager } from './budgetManager.js';

export class QueryApi {
  private readonly endpointMap = new Map<string, QueryEndpoint>();
  private budgetManager: QueryBudgetManager;

  constructor(endpoints: QueryEndpoint[], budget: QueryBudget) {
    for (const endpoint of endpoints) {
      this.endpointMap.set(endpoint.name, endpoint);
    }
    this.budgetManager = new QueryBudgetManager(budget);
  }

  resetTickBudget(budget: QueryBudget): void {
    this.budgetManager = new QueryBudgetManager(budget);
  }

  run(request: QueryRequest, world: WorldState): QueryResult {
    const endpoint = this.endpointMap.get(request.endpoint);
    if (!endpoint) {
      return { ok: false, error: `unknown_endpoint:${request.endpoint}`, bytes: 0, cost: 0 };
    }

    const rawData = endpoint.handler(request.params, world);
    const rawJson = stringifyWithBigInt(rawData ?? null);
    const cappedJson =
      endpoint.maxResponseBytes && Buffer.byteLength(rawJson, 'utf8') > endpoint.maxResponseBytes
        ? rawJson.slice(0, endpoint.maxResponseBytes)
        : rawJson;
    const truncated = cappedJson.length !== rawJson.length;
    const bytes = Buffer.byteLength(cappedJson, 'utf8');
    const canSpend = this.budgetManager.canSpend(endpoint.cost, bytes);
    if (!canSpend.ok) {
      return {
        ok: false,
        error: canSpend.error ?? 'query_budget_exceeded',
        bytes: 0,
        cost: endpoint.cost,
      };
    }

    this.budgetManager.spend(endpoint.cost, bytes);
    return {
      ok: true,
      data: safeParseJson(cappedJson),
      bytes,
      cost: endpoint.cost,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  budgetState() {
    return this.budgetManager.state();
  }
}

function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
