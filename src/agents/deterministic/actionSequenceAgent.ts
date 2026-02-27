import { BaseAgent } from '../../core/agent.js';
import type { Action, TickContext } from '../../core/types.js';

export type SequencedAction = {
  tick: number;
  name: string;
  params: Record<string, unknown>;
};

/**
 * Deterministic agent that returns a pre-defined action sequence by tick.
 *
 * Intended use:
 * - take a successful exploration replay bundle
 * - extract one agent's actions into a deterministic sequence
 * - run cheaply in deterministic CI without any LLM calls
 */
export class ActionSequenceAgent extends BaseAgent {
  private readonly sequence: Map<number, SequencedAction>;

  constructor(id: string, params: Record<string, unknown> = {}) {
    super(id, params);
    const seq = this.getParam<SequencedAction[]>('sequence', []);
    this.sequence = new Map(seq.map((a) => [a.tick, a]));
  }

  async step(ctx: TickContext): Promise<Action | null> {
    const next = this.sequence.get(ctx.tick);
    if (!next) return null;
    return {
      id: this.generateActionId(next.name, ctx.tick),
      name: next.name,
      params: next.params ?? {},
    };
  }
}
