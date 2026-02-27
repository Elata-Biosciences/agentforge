import { z } from 'zod';
import { FilterSchema, QueryTableSchema } from '../query/spec.js';

export const MlKindSchema = z.enum([
  'dataset',
  'export_csv',
  'linear_regression',
  'ridge_regression',
  'logistic_regression',
  'kmeans',
  'pca',
  'anomaly_zscore',
  'timeseries_rolling',
]);
export type MlKind = z.infer<typeof MlKindSchema>;

const BaseSchema = z.object({
  kind: MlKindSchema,
  runId: z.string().min(1),
  table: QueryTableSchema.optional(),
  dataset: z.string().min(1).optional(),
  filters: z.array(FilterSchema).optional(),
  limit: z.number().int().positive().max(50_000).optional(),
});

export const MlDatasetSchema = BaseSchema.extend({
  kind: z.literal('dataset'),
  select: z.array(z.string().min(1)).min(1),
});

export const MlExportCsvSchema = BaseSchema.extend({
  kind: z.literal('export_csv'),
  select: z.array(z.string().min(1)).min(1),
  filename: z.string().optional(),
});

export const MlLinearRegressionSchema = BaseSchema.extend({
  kind: z.literal('linear_regression'),
  x: z.array(z.string().min(1)).min(1),
  y: z.string().min(1),
});

export const MlRidgeRegressionSchema = BaseSchema.extend({
  kind: z.literal('ridge_regression'),
  x: z.array(z.string().min(1)).min(1),
  y: z.string().min(1),
  lambda: z.number().finite().nonnegative().default(1),
});

export const MlLogisticRegressionSchema = BaseSchema.extend({
  kind: z.literal('logistic_regression'),
  x: z.array(z.string().min(1)).min(1),
  y: z.string().min(1),
  maxIter: z.number().int().positive().max(50_000).default(800),
  lr: z.number().finite().positive().default(0.1),
  l2: z.number().finite().nonnegative().default(0),
});

export const MlKmeansSchema = BaseSchema.extend({
  kind: z.literal('kmeans'),
  x: z.array(z.string().min(1)).min(1),
  k: z.number().int().min(2).max(50),
  seed: z.number().int().optional(),
  maxIter: z.number().int().positive().max(10_000).default(100),
});

export const MlPcaSchema = BaseSchema.extend({
  kind: z.literal('pca'),
  x: z.array(z.string().min(1)).min(1),
  components: z.number().int().min(1).max(32).optional(),
});

export const MlAnomalyZscoreSchema = BaseSchema.extend({
  kind: z.literal('anomaly_zscore'),
  field: z.string().min(1),
  threshold: z.number().finite().positive().default(3.5),
});

export const MlTimeseriesRollingSchema = BaseSchema.extend({
  kind: z.literal('timeseries_rolling'),
  field: z.string().min(1),
  window: z.number().int().min(2).max(10_000).default(50),
});

export const MlRequestSchema = z
  .discriminatedUnion('kind', [
    MlDatasetSchema,
    MlExportCsvSchema,
    MlLinearRegressionSchema,
    MlRidgeRegressionSchema,
    MlLogisticRegressionSchema,
    MlKmeansSchema,
    MlPcaSchema,
    MlAnomalyZscoreSchema,
    MlTimeseriesRollingSchema,
  ])
  .superRefine((v, ctx) => {
    if (v.table !== undefined || v.dataset !== undefined) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either table or dataset is required',
      path: ['table'],
    });
  });

export type MlRequest = z.infer<typeof MlRequestSchema>;
