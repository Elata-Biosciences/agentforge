import {
  BaseAgent,
  type LlmClient,
  type LlmProviderConfig,
  type TickContext,
  createLlmProviderClient,
} from '../../../src/index.js';

/**
 * Posts gossip messages using a real LLM provider in exploration mode.
 * Deterministic/replay modes avoid live provider calls by design.
 */
export class ProviderBackedGossipAgent extends BaseAgent {
  private llm: LlmClient | null = null;

  private getProviderConfig(): LlmProviderConfig {
    const provider = String(this.getParam('provider', 'openai'));
    const model = String(this.getParam('model', 'gpt-4o-mini'));
    const baseUrl = this.getParam<string>('baseUrl');
    const apiKey = this.getParam<string>('apiKey');
    return {
      provider: provider as LlmProviderConfig['provider'],
      model,
      ...(typeof baseUrl === 'string' && baseUrl ? { baseUrl } : {}),
      ...(typeof apiKey === 'string' && apiKey ? { apiKey } : {}),
    };
  }

  private getClient(): LlmClient {
    if (this.llm) return this.llm;
    this.llm = createLlmProviderClient(this.getProviderConfig());
    return this.llm;
  }

  override async step(ctx: TickContext) {
    if (!ctx.gossip) return null;
    const every = this.getParam<number>('postEveryTicks', 3);
    if (every <= 0 || ctx.tick % every !== 0) return null;

    const channel = String(this.getParam('channelId', 'global'));
    let text = `mode=${ctx.mode ?? 'deterministic'} tick=${ctx.tick} deterministic-note`;

    if (ctx.mode === 'exploration') {
      const llm = this.getClient();
      const world = JSON.stringify(ctx.world, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      ).slice(0, 2000);
      const response = await llm.complete({
        model: String(this.getParam('model', 'gpt-4o-mini')),
        system:
          'You are an analyst agent in a simulation. Produce one concise tactical message for peer agents.',
        user: `tick=${ctx.tick}\nworld=${world}\nWrite one short line: market/governance risk + suggestion.`,
      });
      text = response.trim().slice(0, 280);
    }

    ctx.gossip.postMessage(
      this.id,
      channel,
      { text },
      {
        audience: { type: 'public' },
        credibilityPrior: ctx.mode === 'exploration' ? 0.7 : 0.95,
      }
    );
    return null;
  }
}
