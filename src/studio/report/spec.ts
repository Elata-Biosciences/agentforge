import { z } from 'zod';
import { MlRequestSchema } from '../ml/spec.js';
import { QuerySpecV1Schema, QueryTableSchema } from '../query/spec.js';

export const ReportBlockIdSchema = z.string().min(1);

export const ReportMarkdownBlockSchema = z.object({
  kind: z.literal('markdown'),
  id: ReportBlockIdSchema.optional(),
  title: z.string().optional(),
  markdown: z.string(),
});

export const ReportDatasetBlockSchema = z.object({
  kind: z.literal('dataset'),
  as: ReportBlockIdSchema,
  title: z.string().optional(),
  table: QueryTableSchema,
  spec: QuerySpecV1Schema,
});

export const TransformSelectStepSchema = z.object({
  kind: z.literal('select'),
  fields: z.array(z.string().min(1)).min(1),
});

export const TransformDeriveStepSchema = z.object({
  kind: z.literal('derive'),
  as: z.string().min(1),
  // Minimal v1: derive from a single source field with a simple op.
  op: z.enum(['to_number', 'to_string', 'abs']),
  field: z.string().min(1),
});

export const TransformExprStepSchema = z.object({
  kind: z.literal('expr'),
  as: z.string().min(1),
  op: z.enum(['ratio', 'diff', 'sum', 'product']),
  left: z.string().min(1),
  right: z.string().min(1),
});

export const TransformRollingStepSchema = z.object({
  kind: z.literal('rolling'),
  as: z.string().min(1),
  field: z.string().min(1),
  window: z.number().int().min(2).max(10_000).default(50),
  op: z.enum(['mean', 'sum', 'min', 'max']),
});

export const TransformCumulativeStepSchema = z.object({
  kind: z.literal('cumulative'),
  as: z.string().min(1),
  field: z.string().min(1),
  op: z.enum(['sum', 'mean']).default('sum'),
});

export const TransformBucketStepSchema = z.object({
  kind: z.literal('bucket'),
  as: z.string().min(1),
  field: z.string().min(1),
  size: z.number().finite().positive().default(1),
});

export const TransformRankStepSchema = z.object({
  kind: z.literal('rank'),
  as: z.string().min(1),
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const TransformStepSchema = z.discriminatedUnion('kind', [
  TransformSelectStepSchema,
  TransformDeriveStepSchema,
  TransformExprStepSchema,
  TransformRollingStepSchema,
  TransformCumulativeStepSchema,
  TransformBucketStepSchema,
  TransformRankStepSchema,
]);
export type TransformStep = z.infer<typeof TransformStepSchema>;

export const ReportTransformBlockSchema = z.object({
  kind: z.literal('transform'),
  as: ReportBlockIdSchema,
  title: z.string().optional(),
  from: ReportBlockIdSchema,
  steps: z.array(TransformStepSchema).min(1),
});

export const ReportMlBlockSchema = z.object({
  kind: z.literal('ml'),
  as: ReportBlockIdSchema,
  title: z.string().optional(),
  request: MlRequestSchema,
});

export const ReportChartBlockSchema = z.object({
  kind: z.literal('chart'),
  id: ReportBlockIdSchema.optional(),
  title: z.string().optional(),
  chartType: z.enum(['line', 'donut', 'scatter', 'bar', 'histogram']),
  dataset: ReportBlockIdSchema,
  xField: z.string().min(1),
  yField: z.string().min(1).optional(),
  seriesField: z.string().min(1).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  showLegend: z.boolean().optional(),
  bins: z.number().int().min(2).max(200).optional(),
});

export const ReportTableBlockSchema = z.object({
  kind: z.literal('table'),
  id: ReportBlockIdSchema.optional(),
  title: z.string().optional(),
  dataset: ReportBlockIdSchema,
  columns: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(50_000).optional(),
});

export const ReportBlockSchema = z.discriminatedUnion('kind', [
  ReportMarkdownBlockSchema,
  ReportDatasetBlockSchema,
  ReportTransformBlockSchema,
  ReportMlBlockSchema,
  ReportChartBlockSchema,
  ReportTableBlockSchema,
]);

export const ReportConfigV1Schema = z.object({
  v: z.literal('v1'),
  blocks: z.array(ReportBlockSchema).min(1),
});

export type ReportConfigV1 = z.infer<typeof ReportConfigV1Schema>;
export type ReportBlock = z.infer<typeof ReportBlockSchema>;
