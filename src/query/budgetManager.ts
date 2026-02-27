import type { QueryBudget, QueryBudgetState } from '../core/types.js';

export class QueryBudgetManager {
  private usedQueries = 0;
  private usedCost = 0;
  private usedBytes = 0;

  constructor(private readonly budget: QueryBudget) {}

  canSpend(cost: number, bytes: number): { ok: boolean; error?: string } {
    if (this.usedQueries + 1 > this.budget.maxQueriesPerTick) {
      return { ok: false, error: 'query_count_budget_exceeded' };
    }
    if (this.usedCost + cost > this.budget.maxCostPerTick) {
      return { ok: false, error: 'query_cost_budget_exceeded' };
    }
    if (this.usedBytes + bytes > this.budget.maxBytesPerTick) {
      return { ok: false, error: 'query_bytes_budget_exceeded' };
    }
    return { ok: true };
  }

  spend(cost: number, bytes: number): void {
    this.usedQueries += 1;
    this.usedCost += cost;
    this.usedBytes += bytes;
  }

  state(): QueryBudgetState {
    return {
      usedQueries: this.usedQueries,
      usedCost: this.usedCost,
      usedBytes: this.usedBytes,
      remainingQueries: Math.max(0, this.budget.maxQueriesPerTick - this.usedQueries),
      remainingCost: Math.max(0, this.budget.maxCostPerTick - this.usedCost),
      remainingBytes: Math.max(0, this.budget.maxBytesPerTick - this.usedBytes),
    };
  }
}
