import { createHash } from 'node:crypto';
import type { Rng } from '../core/rng.js';
import type {
  AudienceSpec,
  DeliveryEvent,
  GossipChannel,
  GossipConfig,
  GossipMessage,
  MessageEnvelope,
  MessagePayload,
} from '../core/types.js';

interface QueuedDelivery {
  deliverAtTick: number;
  recipientAgentId: string;
  message: GossipMessage;
}

interface AgentGossipUsage {
  posts: number;
  postCost: number;
  readMessages: number;
  readChars: number;
}

export class GossipBus {
  private readonly channels = new Map<string, GossipChannel>();
  private readonly inboxes = new Map<string, GossipMessage[]>();
  private readonly queue: QueuedDelivery[] = [];
  private readonly messagesById = new Map<string, GossipMessage>();
  private readonly usageByAgent = new Map<string, AgentGossipUsage>();
  private readonly lastPostTickByAgentChannel = new Map<string, number>();
  private systemSeq = 0;
  private currentTick = 0;

  constructor(private readonly config: GossipConfig) {
    for (const channel of config.channels) {
      this.channels.set(channel.id, channel);
    }
  }

  advanceTick(tick: number): DeliveryEvent[] {
    this.currentTick = tick;
    this.usageByAgent.clear();
    const deliveries = this.queue.filter((q) => q.deliverAtTick <= tick);
    const remaining = this.queue.filter((q) => q.deliverAtTick > tick);
    this.queue.length = 0;
    this.queue.push(...remaining);

    const events: DeliveryEvent[] = [];
    for (const item of deliveries) {
      const inbox = this.inboxes.get(item.recipientAgentId) ?? [];
      inbox.push(item.message);
      this.inboxes.set(item.recipientAgentId, inbox);
      events.push({
        tick,
        messageId: item.message.envelope.id,
        recipientAgentId: item.recipientAgentId,
      });
    }
    return events;
  }

  postMessage(
    agentId: string,
    channelId: string,
    payload: MessagePayload,
    rng: Rng,
    options: Partial<
      Omit<MessageEnvelope, 'id' | 'tick' | 'authorAgentId' | 'channelId' | 'payloadHash'>
    > = {}
  ): { ok: boolean; error?: string; message?: GossipMessage } {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { ok: false, error: `unknown_channel:${channelId}` };
    }

    // Optional per-channel cooldown across ticks.
    if (channel.postCooldownTicks && channel.postCooldownTicks > 0) {
      const key = `${agentId}:${channelId}`;
      const last = this.lastPostTickByAgentChannel.get(key);
      if (last !== undefined && this.currentTick - last < channel.postCooldownTicks) {
        return { ok: false, error: 'post_cooldown_active' };
      }
      this.lastPostTickByAgentChannel.set(key, this.currentTick);
    }

    const usage = this.getUsage(agentId);
    const cost = 1 + Math.ceil(payload.text.length / 120);
    const budgets = this.config.budgets;
    if (usage.posts + 1 > budgets.maxPostsPerTick) {
      return { ok: false, error: 'post_rate_limit_exceeded' };
    }
    if (usage.postCost + cost > budgets.maxPostCostPerTick) {
      return { ok: false, error: 'post_cost_budget_exceeded' };
    }

    usage.posts += 1;
    usage.postCost += cost;

    const credibility = clampCredibility(
      options.credibilityPrior ?? 0.5,
      channel.minCredibilityPrior,
      channel.maxCredibilityPrior
    );
    const envelope: MessageEnvelope = {
      id: `${agentId}-${this.currentTick}-${Math.floor(rng.nextFloat() * 1_000_000)}`,
      tick: this.currentTick,
      authorAgentId: agentId,
      channelId,
      audience: options.audience ?? this.defaultAudience(channel),
      intentTag: options.intentTag ?? 'other',
      costPaid: options.costPaid ?? cost,
      credibilityPrior: credibility,
      payloadHash: hashPayload(payload),
    };

    const message: GossipMessage = { envelope, payload };
    this.messagesById.set(envelope.id, message);
    const recipients = this.resolveRecipients(channel, envelope.audience);
    for (const recipientAgentId of recipients) {
      if (recipientAgentId === agentId) {
        continue;
      }
      if (this.config.dropRate && rng.chance(this.config.dropRate)) {
        continue;
      }
      this.queue.push({
        deliverAtTick: this.currentTick + (this.config.defaultLatencyTicks ?? 0),
        recipientAgentId,
        message,
      });
    }

    return { ok: true, message };
  }

  /**
   * Post a system message that bypasses budgets and cooldowns.
   * Useful for deterministic "external shock" injections.
   */
  postSystemMessage(
    channelId: string,
    payload: MessagePayload,
    rng: Rng,
    options: Partial<
      Omit<MessageEnvelope, 'id' | 'tick' | 'authorAgentId' | 'channelId' | 'payloadHash'>
    > = {}
  ): { ok: boolean; error?: string; message?: GossipMessage } {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return { ok: false, error: `unknown_channel:${channelId}` };
    }

    const credibility = clampCredibility(
      options.credibilityPrior ?? 1,
      channel.minCredibilityPrior,
      channel.maxCredibilityPrior
    );
    const envelope: MessageEnvelope = {
      id: `system-${this.currentTick}-${this.systemSeq++}-${hashPayload(payload).slice(0, 8)}`,
      tick: this.currentTick,
      authorAgentId: 'system',
      channelId,
      audience: options.audience ?? this.defaultAudience(channel),
      intentTag: options.intentTag ?? 'inform',
      costPaid: options.costPaid ?? 0,
      credibilityPrior: credibility,
      payloadHash: hashPayload(payload),
    };
    const message: GossipMessage = { envelope, payload };
    this.messagesById.set(envelope.id, message);

    const recipients = this.resolveRecipients(channel, envelope.audience);
    for (const recipientAgentId of recipients) {
      if (this.config.dropRate && rng.chance(this.config.dropRate)) {
        continue;
      }
      this.queue.push({
        deliverAtTick: this.currentTick + (this.config.defaultLatencyTicks ?? 0),
        recipientAgentId,
        message,
      });
    }

    return { ok: true, message };
  }

  readInbox(agentId: string): GossipMessage[] {
    const usage = this.getUsage(agentId);
    const budgets = this.config.budgets;
    const inbox = this.inboxes.get(agentId) ?? [];
    if (inbox.length === 0) {
      return [];
    }

    const selected: GossipMessage[] = [];
    let readChars = 0;
    for (const msg of inbox) {
      if (selected.length + usage.readMessages >= budgets.maxMessagesReadPerTick) {
        break;
      }
      if (readChars + usage.readChars + msg.payload.text.length > budgets.maxCharsReadPerTick) {
        break;
      }
      selected.push(msg);
      readChars += msg.payload.text.length;
    }

    usage.readMessages += selected.length;
    usage.readChars += readChars;
    this.inboxes.set(agentId, inbox.slice(selected.length));
    return selected;
  }

  getInFlightCount(): number {
    return this.queue.length;
  }

  getMessageById(messageId: string): GossipMessage | null {
    return this.messagesById.get(messageId) ?? null;
  }

  private resolveRecipients(channel: GossipChannel, audience: AudienceSpec): string[] {
    if (audience.type === 'agents') {
      return audience.agentIds;
    }
    if (audience.type === 'channel') {
      const target = this.channels.get(audience.channelId);
      return target?.members ?? [];
    }
    return channel.members ?? [];
  }

  private defaultAudience(channel: GossipChannel): AudienceSpec {
    if (channel.type === 'dm' || channel.type === 'group') {
      return { type: 'channel', channelId: channel.id };
    }
    return { type: 'public' };
  }

  private getUsage(agentId: string): AgentGossipUsage {
    const current = this.usageByAgent.get(agentId);
    if (current) {
      return current;
    }
    const usage: AgentGossipUsage = {
      posts: 0,
      postCost: 0,
      readMessages: 0,
      readChars: 0,
    };
    this.usageByAgent.set(agentId, usage);
    return usage;
  }
}

export function createDefaultGossipConfig(): GossipConfig {
  return {
    channels: [
      { id: 'global', type: 'global' },
      { id: 'markets', type: 'topic' },
      { id: 'governance', type: 'topic' },
    ],
    budgets: {
      maxPostsPerTick: 1,
      maxPostCostPerTick: 10,
      maxMessagesReadPerTick: 20,
      maxCharsReadPerTick: 4000,
    },
    defaultLatencyTicks: 0,
    dropRate: 0,
    paraphraseRate: 0,
  };
}

function hashPayload(payload: MessagePayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function clampCredibility(value: number, min?: number, max?: number): number {
  const lo = min ?? 0;
  const hi = max ?? 1;
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(lo, Math.min(hi, Math.max(0, Math.min(1, value))));
}
