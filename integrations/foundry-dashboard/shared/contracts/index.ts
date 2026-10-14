import { z } from "zod";

export const SchemaVersion = 1;
export const RefreshIntervalMs = 20_000;

export const DataSourceSchema = z.enum(["live", "fixture", "mock"]);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const UsageSourceSchema = z.enum(["platform-metrics", "traces"]);
export type UsageSource = z.infer<typeof UsageSourceSchema>;

export const ResponseStatusSchema = z.enum(["ok", "empty", "error"]);
export type ResponseStatus = z.infer<typeof ResponseStatusSchema>;

export const ErrorCodeSchema = z.enum([
  "auth",
  "not_configured",
  "query_failed",
  "throttled",
  "bad_request",
  "upstream",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const OperationSchema = z.enum(["chat", "invoke_agent", "execute_tool"]);
export type Operation = z.infer<typeof OperationSchema>;
export const Operations: Operation[] = ["chat", "invoke_agent", "execute_tool"];

export const GranularitySchema = z.enum(["auto", "5m", "15m", "1h", "6h", "1d", "7d"]);
export type Granularity = z.infer<typeof GranularitySchema>;
export const ConcreteGranularitySchema = z.enum(["5m", "15m", "1h", "6h", "1d", "7d"]);
export type ConcreteGranularity = z.infer<typeof ConcreteGranularitySchema>;

export const TimeRangePresetSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]);
export const IsoDateStringSchema = z.string().datetime({ offset: true });

export const TimeRangeSchema = z.object({
  from: IsoDateStringSchema,
  to: IsoDateStringSchema,
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const TimeRangeQueryBaseSchema = z
  .object({
    preset: TimeRangePresetSchema.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  });

export const TimeRangeQuerySchema = TimeRangeQueryBaseSchema
  .refine((value) => (value.from && value.to) || value.preset || (!value.from && !value.to), {
    message: "Provide both from and to, or a preset.",
  });
export type TimeRangeQuery = z.infer<typeof TimeRangeQuerySchema>;

const repeatedString = z.union([z.string(), z.array(z.string())]).transform((value) =>
  Array.isArray(value)
    ? value.flatMap((item) => item.split(",")).filter(Boolean)
    : value.split(",").filter(Boolean),
);

export const FiltersQuerySchema = z.object({
  model: repeatedString.optional(),
  agent: repeatedString.optional(),
  operation: z
    .union([OperationSchema, z.array(OperationSchema), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const raw = Array.isArray(value) ? value : String(value).split(",");
      const parsed = z.array(OperationSchema).safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid operation filter." });
        return z.NEVER;
      }
      return parsed.data;
    }),
});

export const FiltersSchema = z.object({
  model: z.array(z.string()).optional(),
  agent: z.array(z.string()).optional(),
  operation: z.array(OperationSchema).optional(),
});
export type Filters = z.infer<typeof FiltersSchema>;

export const TableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(64).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  topN: z.coerce.number().int().min(1).max(100).default(20),
});
export type TableQuery = z.infer<typeof TableQuerySchema>;

export const CommonQueryBaseSchema = TimeRangeQueryBaseSchema.merge(FiltersQuerySchema).extend({
  granularity: GranularitySchema.default("auto"),
});

export const CommonQuerySchema = CommonQueryBaseSchema
  .refine((value) => (value.from && value.to) || value.preset || (!value.from && !value.to), {
    message: "Provide both from and to, or a preset.",
  });
export const TableEndpointQuerySchema = CommonQueryBaseSchema.merge(TableQuerySchema).refine((value) => (value.from && value.to) || value.preset || (!value.from && !value.to), {
  message: "Provide both from and to, or a preset.",
});
export const RecentErrorsQuerySchema = CommonQueryBaseSchema.merge(TableQuerySchema)
  .extend({
    includeRaw: z.coerce.boolean().optional(),
  })
  .refine((value) => (value.from && value.to) || value.preset || (!value.from && !value.to), {
    message: "Provide both from and to, or a preset.",
  });
export type CommonQuery = z.infer<typeof CommonQuerySchema>;

export const MetaSchema = z.object({
  source: DataSourceSchema,
  usageSource: UsageSourceSchema.optional(),
  status: ResponseStatusSchema,
  dataAsOf: IsoDateStringSchema.nullable(),
  queryTimeMs: z.number().nonnegative(),
  granularityUsed: ConcreteGranularitySchema,
  timeRange: TimeRangeSchema,
  warnings: z.array(z.string()),
  costAvailable: z.boolean(),
  priceSource: z.string().nullable(),
  refreshIntervalMs: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
});
export type Meta = z.infer<typeof MetaSchema>;

export const ErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    meta: MetaSchema,
    data,
  });
export type ApiResponse<T> = { meta: Meta; data: T };

export const ApiErrorResponseSchema = z.object({
  meta: MetaSchema,
  error: ErrorBodySchema,
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const TokenTaxonomySchema = z.object({
  input: z.number().nonnegative().nullable(),
  output: z.number().nonnegative().nullable(),
  cached: z.number().nonnegative().nullable(),
  reasoning: z.number().nonnegative().nullable().default(null),
  total: z.number().nonnegative().nullable(),
  cacheHitRatio: z.number().min(0).max(1).nullable(),
});
export type TokenTaxonomy = z.infer<typeof TokenTaxonomySchema>;

export const ErrorTypeSchema = z.enum([
  "rate_limit",
  "content_filter",
  "timeout",
  "auth",
  "server_5xx",
  "client_4xx",
  "cancelled",
  "other",
]);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const PriceTableRowSchema = z.object({
  model: z.string(),
  inputPer1M: z.number().nonnegative(),
  outputPer1M: z.number().nonnegative(),
  cachedPer1M: z.number().nonnegative().optional(),
});
export type PriceTableRow = z.infer<typeof PriceTableRowSchema>;

export const AgentDimensionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AgentDimension = z.infer<typeof AgentDimensionSchema>;

export const HealthDataSchema = z.object({
  source: DataSourceSchema,
  azStatus: z.enum(["logged_in", "logged_out", "unknown"]),
  dataAsOf: IsoDateStringSchema.nullable(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;

export const MetaDataSchema = z.object({
  models: z.array(z.string()),
  agents: z.array(AgentDimensionSchema),
  operations: z.array(OperationSchema),
  projectIds: z.array(z.string()),
  lastDataAt: IsoDateStringSchema.nullable(),
  costAvailable: z.boolean(),
  source: DataSourceSchema,
});
export type MetaData = z.infer<typeof MetaDataSchema>;

export const SparklinePointSchema = z.object({
  ts: IsoDateStringSchema,
  calls: z.number().nonnegative(),
  tokens: z.number().nonnegative().nullable(),
  cost: z.number().nonnegative().nullable(),
  errorRate: z.number().min(0).max(1).nullable(),
});
export const OverviewDataSchema = z.object({
  totals: z.object({
    calls: z.number().nonnegative(),
    input: z.number().nonnegative().nullable(),
    output: z.number().nonnegative().nullable(),
    cached: z.number().nonnegative().nullable(),
    total: z.number().nonnegative().nullable(),
    estCost: z.number().nonnegative().nullable(),
    billedCostMtd: z.number().nonnegative().nullable(),
    errorRate: z.number().min(0).max(1).nullable(),
    successRate: z.number().min(0).max(1).nullable(),
    p50Ms: z.number().nonnegative().nullable(),
    p95Ms: z.number().nonnegative().nullable(),
    avgTokensPerCall: z.number().nonnegative().nullable(),
  }),
  deltas: z.record(z.number()),
  sparkline: z.array(SparklinePointSchema),
});
export type OverviewData = z.infer<typeof OverviewDataSchema>;

export const TokensSeriesPointSchema = TokenTaxonomySchema.extend({
  ts: IsoDateStringSchema,
});
export const TokensSeriesDataSchema = z.object({ points: z.array(TokensSeriesPointSchema) });
export type TokensSeriesData = z.infer<typeof TokensSeriesDataSchema>;

export const TokensByModelDataSchema = z.object({
  rows: z.array(
    z.object({
      model: z.string(),
      input: z.number().nonnegative().nullable(),
      output: z.number().nonnegative().nullable(),
      cached: z.number().nonnegative().nullable(),
      total: z.number().nonnegative().nullable(),
      calls: z.number().nonnegative(),
      costPer1kInput: z.number().nonnegative().nullable(),
      costPer1kOutput: z.number().nonnegative().nullable(),
    }),
  ),
});
export type TokensByModelData = z.infer<typeof TokensByModelDataSchema>;

export const PlatformUsageDataSchema = z.object({
  requests: z.number().nonnegative().nullable(),
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  totalTokens: z.number().nonnegative().nullable(),
  cachedTokens: z.number().nonnegative().nullable(),
  estCost: z.number().nonnegative().nullable(),
  errorRate: z.number().min(0).max(1).nullable(),
  currency: z.literal("USD"),
  priceSource: z.string(),
});
export type PlatformUsageData = z.infer<typeof PlatformUsageDataSchema>;

export const PlatformUsageSeriesPointSchema = z.object({
  ts: IsoDateStringSchema,
  requests: z.number().nonnegative().nullable(),
  inputTokens: z.number().nonnegative().nullable(),
  outputTokens: z.number().nonnegative().nullable(),
  totalTokens: z.number().nonnegative().nullable(),
});
export const PlatformUsageSeriesDataSchema = z.object({
  points: z.array(PlatformUsageSeriesPointSchema),
});
export type PlatformUsageSeriesData = z.infer<typeof PlatformUsageSeriesDataSchema>;

export const PlatformByModelDataSchema = z.object({
  rows: z.array(
    z.object({
      model: z.string(),
      requests: z.number().nonnegative().nullable(),
      inputTokens: z.number().nonnegative().nullable(),
      outputTokens: z.number().nonnegative().nullable(),
      totalTokens: z.number().nonnegative().nullable(),
      estCost: z.number().nonnegative().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type PlatformByModelData = z.infer<typeof PlatformByModelDataSchema>;

export const ModelsDataSchema = z.object({
  rows: z.array(
    z.object({
      model: z.string(),
      calls: z.number().nonnegative(),
      input: z.number().nonnegative().nullable(),
      output: z.number().nonnegative().nullable(),
      cached: z.number().nonnegative().nullable(),
      total: z.number().nonnegative().nullable(),
      estCost: z.number().nonnegative().nullable(),
      p50Ms: z.number().nonnegative().nullable(),
      p90Ms: z.number().nonnegative().nullable(),
      p95Ms: z.number().nonnegative().nullable(),
      p99Ms: z.number().nonnegative().nullable(),
      errorRate: z.number().min(0).max(1).nullable(),
      avgDurationMs: z.number().nonnegative().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type ModelsData = z.infer<typeof ModelsDataSchema>;

export const AgentsDataSchema = z.object({
  rows: z.array(
    z.object({
      agentId: z.string(),
      agent: z.string(),
      calls: z.number().nonnegative(),
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cached: z.number().nonnegative(),
      total: z.number().nonnegative(),
      estCost: z.number().nonnegative(),
      p50Ms: z.number().nonnegative(),
      p95Ms: z.number().nonnegative(),
      errorRate: z.number().min(0).max(1),
      operations: z.object({
        chat: z.number().nonnegative(),
        invoke_agent: z.number().nonnegative(),
        execute_tool: z.number().nonnegative(),
      }),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type AgentsData = z.infer<typeof AgentsDataSchema>;

export const ActivityDataSchema = z.object({
  points: z.array(z.object({ ts: IsoDateStringSchema }).catchall(z.union([z.string(), z.number()]))),
});
export type ActivityData = z.infer<typeof ActivityDataSchema>;

export const OperationsDataSchema = z.object({
  rows: z.array(
    z.object({
      operation: OperationSchema,
      calls: z.number().nonnegative(),
      input: z.number().nonnegative().nullable(),
      output: z.number().nonnegative().nullable(),
      cached: z.number().nonnegative().nullable(),
      estCost: z.number().nonnegative().nullable(),
      p95Ms: z.number().nonnegative().nullable(),
      errorRate: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type OperationsData = z.infer<typeof OperationsDataSchema>;

export const CostSeriesDataSchema = z.object({
  points: z.array(
    z.object({
      ts: IsoDateStringSchema,
      estCost: z.number().nonnegative().nullable(),
      billedCost: z.number().nonnegative().nullable(),
    }),
  ),
  summary: z.object({
    estTotal: z.number().nonnegative().nullable(),
    billedMtd: z.number().nonnegative().nullable(),
    currency: z.literal("USD"),
    projectionMtd: z.number().nonnegative().nullable(),
    costAvailable: z.boolean(),
    priceSource: z.string(),
  }),
});
export type CostSeriesData = z.infer<typeof CostSeriesDataSchema>;

export const CostBreakdownDataSchema = z.object({
  rows: z.array(
    z.object({
      key: z.string(),
      estCost: z.number().nonnegative().nullable(),
      billedCost: z.number().nonnegative().nullable(),
      share: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type CostBreakdownData = z.infer<typeof CostBreakdownDataSchema>;

export const LatencySeriesDataSchema = z.object({
  points: z.array(
    z.object({
      ts: IsoDateStringSchema,
      p50Ms: z.number().nonnegative().nullable(),
      p90Ms: z.number().nonnegative().nullable(),
      p95Ms: z.number().nonnegative().nullable(),
      p99Ms: z.number().nonnegative().nullable(),
    }),
  ),
});
export type LatencySeriesData = z.infer<typeof LatencySeriesDataSchema>;

export const ErrorsSeriesDataSchema = z.object({
  points: z.array(
    z.object({
      ts: IsoDateStringSchema,
      total: z.number().nonnegative(),
      errors: z.number().nonnegative(),
      errorRate: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type ErrorsSeriesData = z.infer<typeof ErrorsSeriesDataSchema>;

export const RecentErrorsDataSchema = z.object({
  rows: z.array(
    z.object({
      ts: IsoDateStringSchema,
      model: z.string(),
      agent: z.string(),
      operation: OperationSchema,
      resultCode: z.string(),
      errorType: ErrorTypeSchema,
      durationMs: z.number().nonnegative().nullable(),
      message: z.string().optional(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type RecentErrorsData = z.infer<typeof RecentErrorsDataSchema>;

export function mapResultCodeToErrorType(resultCode: string): ErrorType {
  const code = resultCode.toLowerCase();
  const numeric = Number.parseInt(code, 10);
  if (code === "429" || code.includes("rate")) return "rate_limit";
  if (code.includes("content")) return "content_filter";
  if (code.includes("timeout") || code === "408" || code === "504") return "timeout";
  if (code === "401" || code === "403" || code.includes("auth")) return "auth";
  if (code.includes("cancel")) return "cancelled";
  if (Number.isFinite(numeric) && numeric >= 500) return "server_5xx";
  if (Number.isFinite(numeric) && numeric >= 400) return "client_4xx";
  return "other";
}

export const RequestRecordSchema = z.object({
  ts: IsoDateStringSchema, model: z.string(), deployment: z.string(),
  modelVersion: z.string(), deploymentSku: z.string(),
  input: z.number().nonnegative().nullable(), output: z.number().nonnegative().nullable(), cached: z.number().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(), priceStatus: z.string(),
  costReason: z.literal("price_scope_unsupported").nullable(),
  durationMs: z.number().nonnegative().nullable(), outcome: z.string(), statusCode: z.number().nullable(),
  streaming: z.boolean().nullable(), ttftMs: z.number().nonnegative().nullable(),
  interChunkMeanMs: z.number().nonnegative().nullable(), streamCompleted: z.boolean().nullable(),
  currentRetailCostUsd: z.number().nonnegative().nullable(), currentRetailPriceBasis: z.string(),
});
export const RequestsDataSchema = z.object({ rows: z.array(RequestRecordSchema), total: z.number().int().nonnegative() });
export type RequestsData = z.infer<typeof RequestsDataSchema>;
export const StreamingDataSchema = z.object({
  calls: z.number().int().nonnegative(), completed: z.number().int().nonnegative(),
  incomplete: z.number().int().nonnegative(), completionUnknown: z.number().int().nonnegative(),
  ttftP50Ms: z.number().nonnegative().nullable(), ttftP95Ms: z.number().nonnegative().nullable(),
  interChunkMeanP50Ms: z.number().nonnegative().nullable(),
  ttftKnown: z.number().int().nonnegative(), interChunkKnown: z.number().int().nonnegative(),
});
export type StreamingData = z.infer<typeof StreamingDataSchema>;

export const EndpointSchemas = {
  health: HealthDataSchema,
  meta: MetaDataSchema,
  overview: OverviewDataSchema,
  tokensSeries: TokensSeriesDataSchema,
  tokensByModel: TokensByModelDataSchema,
  platformUsage: PlatformUsageDataSchema,
  platformUsageSeries: PlatformUsageSeriesDataSchema,
  platformByModel: PlatformByModelDataSchema,
  models: ModelsDataSchema,
  agents: AgentsDataSchema,
  activity: ActivityDataSchema,
  operations: OperationsDataSchema,
  costSeries: CostSeriesDataSchema,
  costBreakdown: CostBreakdownDataSchema,
  latencySeries: LatencySeriesDataSchema,
  errorsSeries: ErrorsSeriesDataSchema,
  recentErrors: RecentErrorsDataSchema,
  requests: RequestsDataSchema,
  streaming: StreamingDataSchema,
} as const;
