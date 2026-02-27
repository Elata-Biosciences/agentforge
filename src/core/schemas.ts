import { z } from 'zod';

/**
 * Zod schemas for runtime validation of AgentForge configurations
 */

/**
 * Schema for assertion configuration
 */
export const AssertionSchema = z.object({
  type: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
  metric: z.string().min(1, 'Metric name cannot be empty'),
  value: z.union([z.number(), z.string()]),
});

export type AssertionInput = z.infer<typeof AssertionSchema>;

/**
 * Schema for metrics configuration
 */
export const MetricsConfigSchema = z.object({
  sampleEveryTicks: z.number().int().positive().default(1),
  track: z.array(z.string()).optional(),
});

export type MetricsConfigInput = z.infer<typeof MetricsConfigSchema>;

/**
 * Schema for agent configuration
 * Note: We can't validate the constructor with Zod, so we use z.unknown()
 */
export const AgentConfigSchema = z.object({
  type: z.function().describe('Agent class constructor'),
  count: z.number().int().positive().min(1, 'Agent count must be at least 1'),
  params: z.record(z.unknown()).optional(),
});

export type AgentConfigInput = z.infer<typeof AgentConfigSchema>;

/**
 * Schema for run options
 */
export const RunOptionsSchema = z.object({
  seed: z.number().int().optional(),
  ticks: z.number().int().positive().optional(),
  tickSeconds: z.number().positive().optional(),
  outDir: z.string().optional(),
  ci: z.boolean().optional(),
  verbose: z.boolean().optional(),
  mode: z.enum(['deterministic', 'exploration', 'replay']).optional(),
  replayBundlePath: z.string().optional(),
  runIdSuffix: z.string().min(1).max(64).optional(),
  live: z.boolean().optional(),
  liveHost: z.string().min(1).optional(),
  livePort: z.number().int().positive().optional(),
  forkUrl: z.string().url().optional(),
  snapshotEvery: z.number().int().positive().optional(),
  watch: z.boolean().optional(),
  json: z.boolean().optional(),
});

export type RunOptionsInput = z.infer<typeof RunOptionsSchema>;

/**
 * Schema for scenario configuration
 */
export const ScenarioConfigSchema = z.object({
  name: z
    .string()
    .min(1, 'Scenario name cannot be empty')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Scenario name can only contain alphanumeric characters, hyphens, and underscores'
    ),
  seed: z.number().int(),
  ticks: z.number().int().nonnegative(),
  tickSeconds: z.number().positive(),
  pack: z.object({
    name: z.string(),
    initialize: z.function(),
    getWorldState: z.function(),
    executeAction: z.function(),
    getMetrics: z.function(),
    cleanup: z.function(),
  }),
  agents: z.array(AgentConfigSchema),
  metrics: MetricsConfigSchema.optional(),
  assertions: z.array(AssertionSchema).optional(),
});

export type ScenarioConfigInput = z.infer<typeof ScenarioConfigSchema>;

/**
 * Validate scenario configuration
 */
export function validateScenarioConfig(input: unknown): ScenarioConfigInput {
  return ScenarioConfigSchema.parse(input);
}

/**
 * Validate run options
 */
export function validateRunOptions(input: unknown): RunOptionsInput {
  return RunOptionsSchema.parse(input);
}

/**
 * Safe validation that returns a result object instead of throwing
 */
export function safeValidateScenarioConfig(input: unknown): {
  success: boolean;
  data?: ScenarioConfigInput;
  error?: z.ZodError;
} {
  const result = ScenarioConfigSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Safe validation for run options
 */
export function safeValidateRunOptions(input: unknown): {
  success: boolean;
  data?: RunOptionsInput;
  error?: z.ZodError;
} {
  const result = RunOptionsSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Format Zod validation errors for human-readable output
 */
export function formatZodError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `  - ${path}${issue.message}`;
  });
  return `Validation errors:\n${issues.join('\n')}`;
}

/**
 * CLI argument schemas
 */
export const CliRunArgsSchema = z.object({
  scenario: z.string().optional(),
  toy: z.boolean().optional(),
  seed: z.coerce.number().int().optional(),
  ticks: z.coerce.number().int().positive().optional(),
  tickSeconds: z.coerce.number().positive().optional(),
  out: z.string().optional(),
  ci: z.boolean().optional(),
  verbose: z.boolean().optional(),
  forkUrl: z.string().url().optional(),
  snapshotEvery: z.coerce.number().int().positive().optional(),
  watch: z.boolean().optional(),
  json: z.boolean().optional(),
});

export type CliRunArgs = z.infer<typeof CliRunArgsSchema>;

/**
 * Validate CLI arguments
 */
export function validateCliRunArgs(input: unknown): CliRunArgs {
  return CliRunArgsSchema.parse(input);
}

/**
 * Schema for forge-sim init options
 */
export const CliInitArgsSchema = z.object({
  path: z.string().optional(),
  force: z.boolean().optional(),
});

export type CliInitArgs = z.infer<typeof CliInitArgsSchema>;

/**
 * Schema for action configuration
 */
export const ActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  params: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

export type ActionInput = z.infer<typeof ActionSchema>;

/**
 * Schema for action result
 */
export const ActionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  events: z
    .array(
      z.object({
        name: z.string(),
        args: z.record(z.unknown()),
      })
    )
    .optional(),
  balanceDeltas: z.record(z.bigint()).optional(),
  gasUsed: z.bigint().optional(),
  txHash: z.string().optional(),
});

export type ActionResultInput = z.infer<typeof ActionResultSchema>;
