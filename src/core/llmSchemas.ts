import { z } from 'zod';

export const LlmActionIntentSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  rationale: z.string().optional(),
  metadata: z
    .object({
      personaId: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type LlmActionIntentInput = z.infer<typeof LlmActionIntentSchema>;

export const LlmPlanIntentSchema = z.object({
  hypothesis: z.string().min(1),
  target: z
    .object({
      domain: z.enum(['market', 'governance', 'fees', 'gossip', 'rpc', 'other']),
      identifier: z.string().min(1),
    })
    .optional(),
  expectedEffect: z.string().min(1),
  preferredActionFamily: z
    .enum([
      'QueryWorld',
      'RpcCall',
      'PostMessage',
      'ContractCall',
      'ContractRead',
      'ProtocolAction',
    ])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type LlmPlanIntentInput = z.infer<typeof LlmPlanIntentSchema>;

export const ReplayBundleSchema = z.object({
  version: z.enum(['v1', 'v2']),
  scenarioName: z.string().min(1),
  seed: z.number().int(),
  mode: z.enum(['deterministic', 'exploration', 'replay']),
  actions: z.array(
    z.object({
      tick: z.number().int().nonnegative(),
      agentId: z.string().min(1),
      action: z
        .object({
          id: z.string(),
          name: z.string(),
          params: z.record(z.unknown()),
          metadata: z.record(z.unknown()).optional(),
        })
        .nullable(),
      result: z
        .object({
          ok: z.boolean(),
          error: z.string().optional(),
        })
        .optional(),
      metricsSnapshot: z.record(z.number()).optional(),
    })
  ),
  messages: z.array(z.object({ tick: z.number().int().nonnegative(), message: z.unknown() })),
  queries: z.array(
    z.object({
      tick: z.number().int().nonnegative(),
      agentId: z.string().min(1),
      request: z.object({
        endpoint: z.string(),
        params: z.record(z.unknown()).optional(),
      }),
      result: z.object({
        ok: z.boolean(),
        data: z.unknown().optional(),
        error: z.string().optional(),
        bytes: z.number().nonnegative(),
        cost: z.number().nonnegative(),
      }),
    })
  ),
  arbitraryExecutions: z.array(
    z.object({
      tick: z.number().int().nonnegative(),
      agentId: z.string().min(1),
      kind: z.enum(['tx', 'rpc']),
      intent: z.unknown(),
      result: z.object({
        ok: z.boolean(),
        response: z.unknown().optional(),
        error: z.string().optional(),
      }),
    })
  ),
});

export type ReplayBundleInput = z.infer<typeof ReplayBundleSchema>;
