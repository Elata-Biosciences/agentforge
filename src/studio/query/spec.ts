import { z } from 'zod';

export const QueryTableSchema = z.enum(['metrics', 'actions', 'evidence']);
export type QueryTable = z.infer<typeof QueryTableSchema>;

export const FilterOpSchema = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']);
export type FilterOp = z.infer<typeof FilterOpSchema>;

export const FilterSchema = z.object({
  field: z.string().min(1),
  op: FilterOpSchema,
  value: z.unknown(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const AggregateOpSchema = z.enum(['count', 'sum', 'avg', 'min', 'max']);
export type AggregateOp = z.infer<typeof AggregateOpSchema>;

export const AggregateSchema = z.object({
  as: z.string().min(1),
  op: AggregateOpSchema,
  field: z.string().optional(), // count can omit
});
export type Aggregate = z.infer<typeof AggregateSchema>;

export const SortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type Sort = z.infer<typeof SortSchema>;

export const QuerySpecV1Schema = z.object({
  v: z.literal('v1'),
  select: z.array(z.string().min(1)).optional(),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.array(z.string().min(1)).optional(),
  aggregates: z.array(AggregateSchema).optional(),
  sort: SortSchema.optional(),
  limit: z.number().int().positive().max(50_000).optional(),
});
export type QuerySpecV1 = z.infer<typeof QuerySpecV1Schema>;

export const QueryRequestSchema = z.object({
  runId: z.string().min(1),
  table: QueryTableSchema,
  spec: QuerySpecV1Schema,
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;
