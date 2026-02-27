import type {
  ArbitraryTxIntent,
  ExplorationAllowlistPolicy,
  Pack,
  ReplayArbitraryExecutionRecord,
  RpcCallIntent,
  RunMode,
} from '../core/types.js';

export interface ArbitraryExecutorOptions {
  mode: RunMode;
  allowlist: ExplorationAllowlistPolicy;
  pack: Pack;
  record?: (record: ReplayArbitraryExecutionRecord) => void;
}

export class ArbitraryExecutor {
  constructor(private readonly options: ArbitraryExecutorOptions) {}

  async executeTx(
    tick: number,
    agentId: string,
    intent: ArbitraryTxIntent
  ): Promise<{ ok: boolean; error?: string; response?: unknown }> {
    if (this.options.mode !== 'exploration') {
      return { ok: false, error: 'arbitrary_execution_requires_exploration_mode' };
    }
    if (this.isAutonomyDisabled()) {
      return { ok: false, error: 'autonomous_rpc_disabled' };
    }

    if (!this.isAllowedContract(intent.to)) {
      return { ok: false, error: `contract_not_allowlisted:${intent.to}` };
    }

    const result = await this.options.pack.executeAction(
      {
        id: `${agentId}-arbitrary-tx-${tick}`,
        name: 'arbitrary_tx',
        params: { to: intent.to, data: intent.data, value: intent.value ?? '0x0' },
      },
      agentId
    );

    const payload =
      result.error !== undefined
        ? { ok: result.ok, error: result.error, response: result.events }
        : { ok: result.ok, response: result.events };
    this.options.record?.({
      tick,
      agentId,
      kind: 'tx',
      intent,
      result: payload,
    });
    return payload;
  }

  async executeRpc(
    tick: number,
    agentId: string,
    intent: RpcCallIntent
  ): Promise<{ ok: boolean; error?: string; response?: unknown }> {
    if (this.options.mode !== 'exploration') {
      return { ok: false, error: 'arbitrary_execution_requires_exploration_mode' };
    }
    if (this.isAutonomyDisabled()) {
      return { ok: false, error: 'autonomous_rpc_disabled' };
    }
    if (!this.options.pack.callRpc) {
      return { ok: false, error: 'pack_does_not_support_rpc' };
    }
    if (!this.isAllowedRpc(intent.method)) {
      return { ok: false, error: `rpc_method_not_allowlisted:${intent.method}` };
    }
    try {
      const response = await this.options.pack.callRpc(intent.method, intent.params ?? []);
      const payload = { ok: true, response };
      this.options.record?.({
        tick,
        agentId,
        kind: 'rpc',
        intent,
        result: payload,
      });
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const payload = { ok: false, error: message };
      this.options.record?.({
        tick,
        agentId,
        kind: 'rpc',
        intent,
        result: payload,
      });
      return payload;
    }
  }

  private isAllowedContract(target: string): boolean {
    const policy = this.getPolicy();
    if (policy === 'aggressive') {
      if (this.options.allowlist.allowedContracts.length > 0) {
        return this.options.allowlist.allowedContracts.some(
          (value) => value.toLowerCase() === target.toLowerCase()
        );
      }
      return target.trim().length > 0;
    }
    return this.options.allowlist.allowedContracts.some(
      (value) => value.toLowerCase() === target.toLowerCase()
    );
  }

  private isAllowedRpc(method: string): boolean {
    const policy = this.getPolicy();
    if (policy === 'aggressive') {
      if (this.options.allowlist.allowedRpcMethods.length > 0) {
        return this.options.allowlist.allowedRpcMethods.includes(method);
      }
      return method.trim().length > 0;
    }
    return this.options.allowlist.allowedRpcMethods.includes(method);
  }

  private getPolicy(): 'strict' | 'aggressive' {
    const envPolicy = process.env.AGENTFORGE_AUTONOMOUS_RPC_POLICY;
    if (envPolicy === 'strict' || envPolicy === 'aggressive') return envPolicy;
    return 'strict';
  }

  private isAutonomyDisabled(): boolean {
    return process.env.AGENTFORGE_DISABLE_AUTONOMOUS_RPC === '1';
  }
}
