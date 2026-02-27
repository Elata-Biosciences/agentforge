import type { InMemoryActionValidatorRegistry } from '../../core/actionRegistry.js';
import { PersonaLlmAgentBase } from './personaLlmAgentBase.js';
import type { LlmClient } from './types.js';

export interface LlmPolicyAgentParams {
  model?: string;
  maxContextChars?: number;
  toolHints?: string;
}

export class LlmPolicyAgent extends PersonaLlmAgentBase {
  constructor(
    id: string,
    params: Record<string, unknown> = {},
    llmClient?: LlmClient,
    registry?: InMemoryActionValidatorRegistry
  ) {
    const personaParams = {
      ...params,
      persona: {
        id: 'adversarial-policy',
        style: 'adversarial protocol planner',
        goals: [
          'Probe for profitable and adversarial opportunities.',
          'Discover permission, sequencing, and economic weaknesses.',
        ],
        riskProfile: 'aggressive',
        constraints: ['Respect scenario budgets and execution mode constraints.'],
        preferredTools: ['QueryWorld', 'RpcCall', 'ContractCall', 'arbitrary_tx'],
      },
      toolHints:
        typeof params.toolHints === 'string'
          ? params.toolHints
          : 'Favor exploit discovery under budget constraints.',
    };
    super(id, personaParams, llmClient, registry);
  }
}
