import type { Action, ActionResult, Pack, WorldState } from '../../../src/core/types.js';

/**
 * Configuration for the OrderingPack
 */
export interface OrderingPackConfig {
  /** Base opportunity value each tick */
  opportunityValue: number;
  /** Volatility of opportunity value */
  valueVolatility: number;
  /** Ordering policy: priority, random, or round-robin */
  orderingPolicy: 'priority' | 'random' | 'round-robin';
  /** Tax rate applied to opportunity capture (0-1) */
  taxRate: number;
  /** Initial balance for each agent */
  initialBalance: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: OrderingPackConfig = {
  opportunityValue: 100,
  valueVolatility: 0.2,
  orderingPolicy: 'priority',
  taxRate: 0.1,
  initialBalance: 10000,
};

/**
 * OrderingPack - A pack for demonstrating ordering policy effects
 *
 * Each tick, an opportunity with some value appears. Agents can attempt
 * to capture it. The ordering policy determines who gets to act first.
 */
export class OrderingPack implements Pack {
  readonly name = 'OrderingPack';

  private config: OrderingPackConfig;
  private currentTick = 0;
  private currentTimestamp = 0;
  private currentOpportunityValue = 0;
  private opportunityCaptured = false;
  private opportunityCapturedBy: string | null = null;

  // Metrics
  private totalOpportunities = 0;
  private capturedBySearchers = 0;
  private capturedByUsers = 0;
  private totalSearcherProfit = 0;
  private totalUserProfit = 0;
  private totalMechanismRevenue = 0;
  private slippageSum = 0;
  private slippageCount = 0;

  // Agent state
  private balances: Map<string, number> = new Map();
  private priorityFees: Map<string, number> = new Map();
  private currentAgentId: string | null = null;

  constructor(config: Partial<OrderingPackConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    // Reset state
    this.currentTick = 0;
    this.totalOpportunities = 0;
    this.capturedBySearchers = 0;
    this.capturedByUsers = 0;
    this.totalSearcherProfit = 0;
    this.totalUserProfit = 0;
    this.totalMechanismRevenue = 0;
    this.slippageSum = 0;
    this.slippageCount = 0;
    this.balances.clear();
    this.priorityFees.clear();
  }

  onTick(tick: number, timestamp: number): void {
    this.currentTick = tick;
    this.currentTimestamp = timestamp;

    // Generate new opportunity
    const volatilityFactor = 1 + (Math.random() - 0.5) * 2 * this.config.valueVolatility;
    this.currentOpportunityValue = Math.max(0, this.config.opportunityValue * volatilityFactor);
    this.opportunityCaptured = false;
    this.opportunityCapturedBy = null;
    this.totalOpportunities++;

    // Reset priority fees for this tick
    this.priorityFees.clear();
  }

  setCurrentAgent(agentId: string): void {
    this.currentAgentId = agentId;

    // Initialize balance if new agent
    if (!this.balances.has(agentId)) {
      this.balances.set(agentId, this.config.initialBalance);
    }
  }

  getWorldState(): WorldState {
    return {
      timestamp: this.currentTimestamp,
      tick: this.currentTick,
      opportunityValue: this.currentOpportunityValue,
      opportunityCaptured: this.opportunityCaptured,
      opportunityCapturedBy: this.opportunityCapturedBy,
      orderingPolicy: this.config.orderingPolicy,
      taxRate: this.config.taxRate,
      agentBalance: this.currentAgentId ? (this.balances.get(this.currentAgentId) ?? 0) : 0,
    };
  }

  async executeAction(action: Action, agentId: string): Promise<ActionResult> {
    switch (action.name) {
      case 'captureOpportunity':
        return this.handleCaptureOpportunity(action, agentId);
      case 'setPriorityFee':
        return this.handleSetPriorityFee(action, agentId);
      case 'trade':
        return this.handleTrade(action, agentId);
      default:
        return { ok: false, error: `Unknown action: ${action.name}` };
    }
  }

  private handleCaptureOpportunity(_action: Action, agentId: string): ActionResult {
    // Check if opportunity already captured
    if (this.opportunityCaptured) {
      return {
        ok: false,
        error: 'Opportunity already captured',
      };
    }

    // Check agent balance
    const balance = this.balances.get(agentId) ?? 0;
    const priorityFee = this.priorityFees.get(agentId) ?? 0;

    if (balance < priorityFee) {
      return {
        ok: false,
        error: 'Insufficient balance for priority fee',
      };
    }

    // Calculate capture value after tax
    const grossValue = this.currentOpportunityValue;
    const tax = grossValue * this.config.taxRate;
    const netValue = grossValue - tax - priorityFee;

    // Update state
    this.opportunityCaptured = true;
    this.opportunityCapturedBy = agentId;
    this.balances.set(agentId, balance + netValue);
    this.totalMechanismRevenue += tax + priorityFee;

    // Track by agent type (inferred from ID)
    const isSearcher = agentId.includes('Searcher');
    if (isSearcher) {
      this.capturedBySearchers++;
      this.totalSearcherProfit += netValue;
    } else {
      this.capturedByUsers++;
      this.totalUserProfit += netValue;
    }

    return {
      ok: true,
      balanceDeltas: { [agentId]: BigInt(Math.floor(netValue)) },
    };
  }

  private handleSetPriorityFee(action: Action, agentId: string): ActionResult {
    const fee = action.params.fee as number;
    if (typeof fee !== 'number' || fee < 0) {
      return { ok: false, error: 'Invalid priority fee' };
    }

    const balance = this.balances.get(agentId) ?? 0;
    if (balance < fee) {
      return { ok: false, error: 'Insufficient balance for priority fee' };
    }

    this.priorityFees.set(agentId, fee);
    return { ok: true };
  }

  private handleTrade(action: Action, agentId: string): ActionResult {
    // Simulate a regular user trade with potential slippage
    const expectedValue = action.params.expectedValue as number;
    const actualValue = (action.params.actualValue as number) ?? expectedValue;

    if (typeof expectedValue !== 'number') {
      return { ok: false, error: 'Invalid trade parameters' };
    }

    // Calculate slippage
    const slippage = Math.abs(actualValue - expectedValue) / expectedValue;
    this.slippageSum += slippage;
    this.slippageCount++;

    // Update balance
    const balance = this.balances.get(agentId) ?? 0;
    this.balances.set(agentId, balance + actualValue);

    return {
      ok: true,
      balanceDeltas: { [agentId]: BigInt(Math.floor(actualValue)) },
    };
  }

  getMetrics(): Record<string, number | bigint | string> {
    const avgSlippage = this.slippageCount > 0 ? this.slippageSum / this.slippageCount : 0;

    return {
      tick: this.currentTick,
      totalOpportunities: this.totalOpportunities,
      capturedBySearchers: this.capturedBySearchers,
      capturedByUsers: this.capturedByUsers,
      totalSearcherProfit: this.totalSearcherProfit,
      totalUserProfit: this.totalUserProfit,
      mechanismRevenue: this.totalMechanismRevenue,
      averageSlippage: avgSlippage,
      captureRate:
        this.totalOpportunities > 0
          ? (this.capturedBySearchers + this.capturedByUsers) / this.totalOpportunities
          : 0,
      searcherDominance:
        this.capturedBySearchers + this.capturedByUsers > 0
          ? this.capturedBySearchers / (this.capturedBySearchers + this.capturedByUsers)
          : 0,
    };
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }
}
