import type {
  Action,
  ActionValidationContext,
  ActionValidator,
  ActionValidatorRegistry,
} from './types.js';

export class InMemoryActionValidatorRegistry implements ActionValidatorRegistry {
  private readonly validators = new Map<string, ActionValidator>();

  register(actionName: string, validator: ActionValidator): void {
    this.validators.set(actionName, validator);
  }

  validate(action: Action, context: ActionValidationContext): { ok: boolean; error?: string } {
    const validator = this.validators.get(action.name);
    if (!validator) {
      return { ok: true };
    }
    return validator(action, context);
  }
}

export function createDefaultActionRegistry(): InMemoryActionValidatorRegistry {
  const registry = new InMemoryActionValidatorRegistry();
  registry.register('DoNothing', () => ({ ok: true }));
  registry.register('PostMessage', (action) => {
    const channelId = action.params.channelId;
    const text = action.params.text;
    const intentTag = action.params.intentTag;
    if (typeof channelId !== 'string' || channelId.length === 0) {
      return { ok: false, error: 'PostMessage requires channelId' };
    }
    if (typeof text !== 'string') {
      return { ok: false, error: 'PostMessage requires text' };
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: 'PostMessage text must be non-empty' };
    }
    if (trimmed.length > 600) {
      return { ok: false, error: 'PostMessage text exceeds max length (600)' };
    }
    if (intentTag !== undefined) {
      const normalized = String(intentTag).trim();
      const allowed = new Set([
        'inform',
        'persuade',
        'coordinate',
        'deceive',
        'probe',
        'other',
        'creator',
        'economic',
        'bad_actor',
        'saboteur',
        'hacker',
        'observer',
      ]);
      if (!allowed.has(normalized)) {
        return { ok: false, error: `PostMessage intentTag invalid:${normalized}` };
      }
    }
    return { ok: true };
  });
  registry.register('QueryWorld', (action) => {
    const endpoint = action.params.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      return { ok: false, error: 'QueryWorld requires endpoint' };
    }
    return { ok: true };
  });
  registry.register('RpcCall', (action) => {
    const method = action.params.method;
    if (typeof method !== 'string' || method.length === 0) {
      return { ok: false, error: 'RpcCall requires method' };
    }
    const params = action.params.params;
    if (params !== undefined && !Array.isArray(params)) {
      return { ok: false, error: 'RpcCall params must be an array' };
    }
    return { ok: true };
  });
  registry.register('arbitrary_tx', (action) => {
    const to = action.params.to;
    const data = action.params.data;
    if (typeof to !== 'string' || to.length === 0) {
      return { ok: false, error: 'arbitrary_tx requires to' };
    }
    if (typeof data !== 'string' || data.length === 0) {
      return { ok: false, error: 'arbitrary_tx requires data' };
    }
    return { ok: true };
  });
  registry.register('ContractCall', (action, context) => {
    if (context.mode === 'deterministic') {
      return { ok: false, error: 'ContractCall requires exploration or replay mode' };
    }
    const contract = action.params.contract;
    const fn = action.params.function;
    const args = action.params.args;
    if (typeof contract !== 'string' || contract.length === 0) {
      return { ok: false, error: 'ContractCall requires contract' };
    }
    if (typeof fn !== 'string' || fn.length === 0) {
      return { ok: false, error: 'ContractCall requires function' };
    }
    if (!Array.isArray(args)) {
      return { ok: false, error: 'ContractCall args must be an array' };
    }
    return { ok: true };
  });
  registry.register('ContractRead', (action) => {
    const contract = action.params.contract;
    const fn = action.params.function;
    const args = action.params.args;
    if (typeof contract !== 'string' || contract.length === 0) {
      return { ok: false, error: 'ContractRead requires contract' };
    }
    if (typeof fn !== 'string' || fn.length === 0) {
      return { ok: false, error: 'ContractRead requires function' };
    }
    if (!Array.isArray(args)) {
      return { ok: false, error: 'ContractRead args must be an array' };
    }
    return { ok: true };
  });
  return registry;
}
