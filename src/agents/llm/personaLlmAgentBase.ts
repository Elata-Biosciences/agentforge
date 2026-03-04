import {
  type InMemoryActionValidatorRegistry,
  createDefaultActionRegistry,
} from '../../core/actionRegistry.js';
import { BaseAgent } from '../../core/agent.js';
import { LlmActionIntentSchema, LlmPlanIntentSchema } from '../../core/llmSchemas.js';
import type { Action, GossipMessage, TickContext } from '../../core/types.js';
import { createLlmProviderClient } from './providers/factory.js';
import type { LlmClient, LlmProviderConfig } from './types.js';

export interface PersonaProfile {
  id: string;
  style: string;
  goals: string[];
  riskProfile: string;
  constraints?: string[];
  preferredTools?: string[];
}

export interface PersonaLlmAgentParams {
  model?: string;
  maxContextChars?: number;
  toolHints?: string;
  persona?: Partial<PersonaProfile>;
}

interface PlanState {
  hypothesis: string;
  beliefSnapshot: string[];
  pendingHypotheses: string[];
  recentActions: string[];
  recentOutcomes: string[];
  lastWorldFingerprint?: string;
  lastOutcome?: string;
}

interface PlanIntent {
  hypothesis: string;
  expectedEffect: string;
  preferredActionFamily?: string;
  confidence?: number;
}

export class PersonaLlmAgentBase extends BaseAgent {
  private readonly llm: LlmClient;
  private readonly registry: InMemoryActionValidatorRegistry;
  private readonly maxContextChars: number;
  private readonly model: string;
  private readonly toolHints: string;
  private readonly persona: PersonaProfile;

  constructor(
    id: string,
    params: Record<string, unknown> = {},
    llmClient?: LlmClient,
    registry?: InMemoryActionValidatorRegistry
  ) {
    super(id, params);
    this.llm = llmClient ??
      this.tryCreateProviderClient(params) ?? {
        complete: async () => '{"name":"DoNothing","params":{},"rationale":"fallback"}',
      };
    this.registry = registry ?? createDefaultActionRegistry();
    this.maxContextChars = this.getParam('maxContextChars', 16_000);
    this.model = this.getParam('model', 'gpt-4o-mini');
    this.toolHints = this.getParam('toolHints', '');
    this.persona = this.resolvePersona(this.getParam('persona', {}));
    this.remember('persona_profile', this.persona);
  }

  private tryCreateProviderClient(params: Record<string, unknown>): LlmClient | null {
    const provider = params.provider as string | undefined;
    if (!provider) return null;
    try {
      const config: LlmProviderConfig = {
        provider: provider as LlmProviderConfig['provider'],
        ...(typeof params.model === 'string' ? { model: params.model } : {}),
        ...(typeof params.apiKey === 'string' ? { apiKey: params.apiKey } : {}),
        ...(typeof params.baseUrl === 'string' ? { baseUrl: params.baseUrl } : {}),
      };
      return createLlmProviderClient(config);
    } catch {
      return null;
    }
  }

  async step(ctx: TickContext): Promise<Action | Action[] | null> {
    const observedMessages = this.observeMessages(ctx);
    const observation = this.buildObservation(ctx, observedMessages);
    const plan = this.orient(observation, ctx, observedMessages);
    const rawPlan = await this.llm.complete({
      model: this.model,
      system: this.systemPrompt('plan'),
      user: this.userPrompt(observation, plan),
    });
    const parsedPlan = this.parsePlan(rawPlan);
    if (parsedPlan) {
      this.remember('last_plan', parsedPlan);
    }
    const rawDecision = await this.llm.complete({
      model: this.model,
      system: this.systemPrompt('act'),
      user: `${this.userPrompt(observation, plan)}\nplan=${safeJson(parsedPlan ?? { fallback: true })}`,
    });

    const parsedList = this.parseDecisions(rawDecision) ?? this.parseDecisions(rawPlan);
    if (!parsedList || parsedList.length === 0) {
      return null;
    }

    const actions: Action[] = [];
    for (const parsed of parsedList) {
      const metadata = {
        personaId: parsed.metadata?.personaId ?? this.persona.id,
        ...(parsed.rationale ? { rationale: parsed.rationale } : {}),
        ...(parsed.metadata?.confidence !== undefined
          ? { confidence: parsed.metadata.confidence }
          : {}),
      };
      const action: Action = {
        id: this.generateActionId(parsed.name, ctx.tick),
        name: parsed.name,
        params: parsed.params,
        metadata,
      };

      const validation = this.registry.validate(action, {
        mode: ctx.mode ?? 'deterministic',
        world: ctx.world,
      });
      if (!validation.ok) {
        this.remember('last_rejection', validation.error ?? 'invalid_action');
        this.recordOutcome(`rejected:${validation.error ?? 'invalid_action'}`);
        continue;
      }
      actions.push(action);
    }

    if (actions.length === 0) return null;

    const primary = actions[0]!;
    this.remember('last_action', primary.name);
    this.recordAction(primary.name, ctx.tick);
    this.recordOutcome('action_selected');
    this.remember('last_observation', observation.slice(0, 2000));
    this.remember('last_persona_intent', {
      tick: ctx.tick,
      personaId: this.persona.id,
      action: primary.name,
      rationale: parsedList[0]?.rationale ?? null,
    });
    return actions.length === 1 ? actions[0]! : actions;
  }

  protected systemPrompt(stage: 'plan' | 'act'): string {
    const personaLine = [
      `Persona id=${this.persona.id}`,
      `style=${this.persona.style}`,
      `risk=${this.persona.riskProfile}`,
      `goals=${this.persona.goals.join('; ')}`,
      `constraints=${(this.persona.constraints ?? []).join('; ') || 'none'}`,
      `preferredTools=${(this.persona.preferredTools ?? []).join(',') || 'any'}`,
    ].join(' | ');
    const base = [
      'You are a protocol policy planner.',
      'Use the loop: hypothesis -> probe -> action -> outcome -> revise.',
      'Ground each action in the current world and your persona goals.',
      'IMPORTANT: Query endpoints are scenario-defined; if unsure, use QueryWorld endpoint "get_world" first.',
      'IMPORTANT: Do not loop on QueryWorld. After you have a usable world snapshot, attempt a concrete action.',
      'Tool-like actions when available:',
      '- QueryWorld: {"endpoint":"name","params":{}}',
      '- RpcCall: {"method":"eth_*","params":[]}',
      '- arbitrary_tx: {"to":"0x... or ContractAlias","data":"0x...","value":"0x0"}',
      '- ContractCall: {"contract":"Alias","function":"fn","args":[],"value":"0x0"}',
      '- ContractRead: {"contract":"Alias","function":"viewFn","args":[]}',
      'You may return a single action or multiple actions per turn: {"actions":[{...},{...}]} (max 3).',
      'Return STRICT JSON: {"name":"ActionName","params":{},"rationale":"...","metadata":{"personaId":"...","confidence":0.0}}',
      `Persona directive: ${personaLine}`,
      stage === 'plan'
        ? 'Stage PLAN: return STRICT JSON {"hypothesis":"...","expectedEffect":"...","preferredActionFamily":"QueryWorld|RpcCall|PostMessage|ContractCall|ContractRead|ProtocolAction","confidence":0.0}'
        : 'Stage ACT: return STRICT JSON action or actions array',
    ].join(' ');

    const hints = this.toolHints.trim();
    if (hints.length === 0) {
      return base;
    }
    return `${base} Tool hints: ${hints}`;
  }

  protected userPrompt(observation: string, plan: PlanState): string {
    return `Current orient state: ${JSON.stringify(plan)}\nObservation:\n${observation}`;
  }

  private resolvePersona(rawPersona: Partial<PersonaProfile>): PersonaProfile {
    const defaultPersona: PersonaProfile = {
      id: this.id,
      style: 'pragmatic explorer',
      goals: ['Increase expected utility under budget constraints.'],
      riskProfile: 'balanced',
      constraints: ['Prefer reversible actions when uncertain.'],
      preferredTools: ['QueryWorld'],
    };
    return {
      ...defaultPersona,
      ...rawPersona,
      goals:
        Array.isArray(rawPersona.goals) && rawPersona.goals.length > 0
          ? rawPersona.goals
          : defaultPersona.goals,
    };
  }

  private observeMessages(ctx: TickContext): GossipMessage[] {
    if (!ctx.gossip) {
      return [];
    }
    return ctx.gossip.readInbox(this.id);
  }

  private buildObservation(ctx: TickContext, messages: GossipMessage[]): string {
    const worldDelta = this.worldDeltaSummary(ctx.world);
    const worldSnapshot = safeJson(ctx.world).slice(0, 6000);
    const highSignalMessages = messages
      .slice(-8)
      .map((m) => `[${m.envelope.channelId}] ${m.envelope.authorAgentId}: ${m.payload.text}`)
      .join('\n');
    const queryState = ctx.query?.budget
      ? `queryBudget=${JSON.stringify(ctx.query.budget)}`
      : 'queryBudget=none';
    const outcomeMemory = this.recall<string[]>('recent_outcomes', [])?.join('\n') ?? '';
    const actionMemory = this.recall<string[]>('recent_actions', [])?.join('\n') ?? '';
    const lastResult = ctx.lastResult ? safeJson(ctx.lastResult).slice(0, 3000) : 'null';
    const capabilities = ctx.capabilities
      ? safeJson({
          tools: ctx.capabilities.tools,
          queryEndpoints: ctx.capabilities.queryEndpoints,
          contracts: ctx.capabilities.contracts.map((c) => ({
            alias: c.alias,
            ...(c.address ? { address: c.address } : {}),
            ...(c.description ? { description: c.description } : {}),
            ...(c.callable?.length ? { callable: c.callable } : {}),
          })),
          actionTemplates: ctx.capabilities.actionTemplates,
        }).slice(0, 4000)
      : 'none';
    return `tick=${ctx.tick}\nmode=${ctx.mode ?? 'deterministic'}\npersona=${this.persona.id}\n${queryState}\nlastResult=${lastResult}\nworldSnapshot=${worldSnapshot}\nworldDelta=${worldDelta}\nrecentActions=${actionMemory}\nrecentOutcomes=${outcomeMemory}\ncapabilities=${capabilities}\nmessages=${highSignalMessages}`.slice(
      0,
      this.maxContextChars
    );
  }

  private orient(observation: string, ctx: TickContext, messages: GossipMessage[]): PlanState {
    const previous = this.recall<PlanState>('plan_state', {
      hypothesis: 'Probe for opportunities aligned with persona goals.',
      beliefSnapshot: [],
      pendingHypotheses: ['Look for a low-regret action in the current state.'],
      recentActions: [],
      recentOutcomes: [],
    })!;
    const updatedBeliefs = [
      `tick:${ctx.tick}`,
      `persona:${this.persona.id}`,
      `messagesSeen:${messages.length}`,
      `queryBudgetRemaining:${ctx.query ? JSON.stringify(ctx.query.budget) : 'none'}`,
      `worldDelta:${this.worldDeltaSummary(ctx.world)}`,
    ].slice(0, 8);
    const next: PlanState = {
      hypothesis: previous.hypothesis,
      beliefSnapshot: updatedBeliefs,
      pendingHypotheses: this.rollWindow(
        [
          ...previous.pendingHypotheses,
          'Check whether world changes unlock new high-value actions.',
        ],
        6
      ),
      recentActions: this.recall<string[]>('recent_actions', []) ?? [],
      recentOutcomes: this.recall<string[]>('recent_outcomes', []) ?? [],
      lastWorldFingerprint: safeJson(ctx.world).slice(0, 512),
      lastOutcome: `Observed ${Math.min(observation.length, this.maxContextChars)} chars of context`,
    };
    this.remember('plan_state', next);
    return next;
  }

  private parseDecisions(rawDecision: string): Array<{
    name: string;
    params: Record<string, unknown>;
    rationale?: string;
    metadata?: { personaId?: string; confidence?: number };
  }> | null {
    try {
      const normalized = rawDecision.trim();
      const asJson =
        normalized.startsWith('{') || normalized.startsWith('[')
          ? normalized
          : extractJsonObject(normalized);
      const raw = JSON.parse(asJson);

      const items: unknown[] = Array.isArray(raw?.actions) ? raw.actions : [raw];
      const results: Array<{
        name: string;
        params: Record<string, unknown>;
        rationale?: string;
        metadata?: { personaId?: string; confidence?: number };
      }> = [];

      for (const item of items.slice(0, 3)) {
        try {
          const parsed = LlmActionIntentSchema.parse(item);
          const metadata =
            parsed.metadata !== undefined
              ? {
                  ...(parsed.metadata.personaId !== undefined
                    ? { personaId: parsed.metadata.personaId }
                    : {}),
                  ...(parsed.metadata.confidence !== undefined
                    ? { confidence: parsed.metadata.confidence }
                    : {}),
                }
              : undefined;
          results.push({
            name: parsed.name,
            params: parsed.params,
            ...(parsed.rationale !== undefined ? { rationale: parsed.rationale } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
          });
        } catch {
          // skip unparseable items
        }
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  private parsePlan(rawDecision: string): PlanIntent | null {
    try {
      const normalized = rawDecision.trim();
      const asJson = normalized.startsWith('{') ? normalized : extractJsonObject(normalized);
      const parsed = LlmPlanIntentSchema.parse(JSON.parse(asJson));
      return {
        hypothesis: parsed.hypothesis,
        expectedEffect: parsed.expectedEffect,
        ...(parsed.preferredActionFamily
          ? { preferredActionFamily: parsed.preferredActionFamily }
          : {}),
        ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
      };
    } catch {
      return null;
    }
  }

  private worldDeltaSummary(world: Record<string, unknown>): string {
    const previousWorld = this.recall<Record<string, unknown>>('last_world_snapshot');
    this.remember('last_world_snapshot', world);
    if (!previousWorld) {
      return 'initial_world';
    }
    const changedKeys: string[] = [];
    const allKeys = new Set([...Object.keys(previousWorld), ...Object.keys(world)]);
    for (const key of allKeys) {
      const prev = safeJson(previousWorld[key]);
      const curr = safeJson(world[key]);
      if (prev !== curr) changedKeys.push(key);
    }
    if (changedKeys.length === 0) {
      return 'no_material_change';
    }
    return `changed_keys:[${changedKeys.join(',')}]`;
  }

  private rollWindow(values: string[], max: number): string[] {
    return values.slice(Math.max(0, values.length - max));
  }

  private recordAction(actionName: string, tick: number): void {
    const current = this.recall<string[]>('recent_actions', []) ?? [];
    current.push(`tick:${tick}:${actionName}`);
    this.remember('recent_actions', this.rollWindow(current, 12));
  }

  private recordOutcome(outcome: string): void {
    const current = this.recall<string[]>('recent_outcomes', []) ?? [];
    current.push(outcome);
    this.remember('recent_outcomes', this.rollWindow(current, 12));
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('No JSON object found');
  }
  return text.slice(start, end + 1);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}
