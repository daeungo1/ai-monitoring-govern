import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  ApiResponseSchema,
  CommonQuerySchema,
  EndpointSchemas,
  FiltersSchema,
  RecentErrorsQuerySchema,
  RefreshIntervalMs,
  SchemaVersion,
  TableEndpointQuerySchema,
  TableQuerySchema,
  type UsageSource,
} from "../../shared/contracts/index.js";
import { MockTelemetryAdapter } from "../../server/adapters/mock.js";
import type { AdapterResult, QueryContext } from "../../server/adapters/types.js";
import { PRICE_SOURCE } from "../../server/pricing.js";
import { resolveGranularity, resolveTimeRange } from "../../server/time.js";

type RawQuery = Record<string, string | string[] | number | boolean | undefined>;

type EndpointCase = {
  name: string;
  schema: ZodTypeAny;
  table?: boolean;
  recentErrors?: boolean;
  usageSource?: UsageSource;
  run: (adapter: MockTelemetryAdapter, ctx: QueryContext) => Promise<AdapterResult<unknown>>;
};

const fixedTo = "2026-04-08T12:00:00.000Z";
const miniModel = "gpt-5.4-mini-2026-03-17";
const weatherAgent = "WeatherAgent";

function statusFromData(data: unknown): "ok" | "empty" {
  const payload = data as { rows?: unknown[]; points?: unknown[] };
  if (Array.isArray(payload.rows) && payload.rows.length === 0) return "empty";
  if (Array.isArray(payload.points) && payload.points.length === 0) return "empty";
  return "ok";
}

function contextFrom(rawQuery: RawQuery, options: { table?: boolean; recentErrors?: boolean } = {}): QueryContext {
  const parsed = (options.recentErrors
    ? RecentErrorsQuerySchema
    : options.table
      ? TableEndpointQuerySchema
      : CommonQuerySchema
  ).parse(rawQuery);
  const range = resolveTimeRange(parsed);
  const granularity = resolveGranularity(range, parsed.granularity);
  const filters = FiltersSchema.parse({
    model: parsed.model,
    agent: parsed.agent,
    operation: parsed.operation,
  });
  const table = TableQuerySchema.parse(parsed);

  return {
    range,
    granularity,
    filters,
    table,
    includeRaw: Boolean(options.recentErrors && (parsed as { includeRaw?: boolean }).includeRaw === true),
  };
}

function envelope<T>(adapter: MockTelemetryAdapter, ctx: QueryContext, result: AdapterResult<T>, usageSource?: UsageSource) {
  return {
    meta: {
      source: adapter.source,
      ...(usageSource ? { usageSource } : {}),
      status: statusFromData(result.data),
      dataAsOf: result.dataAsOf,
      queryTimeMs: 1,
      granularityUsed: ctx.granularity,
      timeRange: ctx.range,
      warnings: result.warnings,
      costAvailable: result.costAvailable,
      priceSource: PRICE_SOURCE,
      refreshIntervalMs: RefreshIntervalMs,
      schemaVersion: SchemaVersion,
    },
    data: result.data,
  };
}

const commonQueries: RawQuery[] = [
  { preset: "1h", to: fixedTo, granularity: "auto" },
  {
    from: "2026-04-07T12:00:00.000Z",
    to: fixedTo,
    granularity: "15m",
    model: miniModel,
    operation: "chat",
  },
  {
    from: "2026-04-01T00:00:00.000Z",
    to: fixedTo,
    granularity: "6h",
    agent: weatherAgent,
    operation: ["invoke_agent", "execute_tool"],
  },
];

const tableQueries: RawQuery[] = commonQueries.map((query, index) => ({
  ...query,
  page: index + 1,
  pageSize: index === 0 ? 5 : 10,
  sort: index === 2 ? "estCost" : "calls",
  dir: index === 1 ? "asc" : "desc",
}));

const recentErrorQueries: RawQuery[] = tableQueries.map((query, index) => ({
  ...query,
  includeRaw: index === 1,
}));

const endpoints: EndpointCase[] = [
  { name: "health", schema: EndpointSchemas.health, run: (adapter) => adapter.health() },
  { name: "meta", schema: EndpointSchemas.meta, run: (adapter, ctx) => adapter.meta(ctx) },
  { name: "overview", schema: EndpointSchemas.overview, run: (adapter, ctx) => adapter.overview(ctx) },
  { name: "tokensSeries", schema: EndpointSchemas.tokensSeries, run: (adapter, ctx) => adapter.tokensSeries(ctx) },
  { name: "tokensByModel", schema: EndpointSchemas.tokensByModel, table: true, run: (adapter, ctx) => adapter.tokensByModel(ctx) },
  {
    name: "platformUsage",
    schema: EndpointSchemas.platformUsage,
    usageSource: "platform-metrics",
    run: (adapter, ctx) => adapter.platformUsage(ctx),
  },
  {
    name: "platformUsageSeries",
    schema: EndpointSchemas.platformUsageSeries,
    usageSource: "platform-metrics",
    run: (adapter, ctx) => adapter.platformUsageSeries(ctx),
  },
  {
    name: "platformByModel",
    schema: EndpointSchemas.platformByModel,
    table: true,
    usageSource: "platform-metrics",
    run: (adapter, ctx) => adapter.platformByModel(ctx),
  },
  { name: "models", schema: EndpointSchemas.models, table: true, run: (adapter, ctx) => adapter.models(ctx) },
  { name: "agents", schema: EndpointSchemas.agents, table: true, run: (adapter, ctx) => adapter.agents(ctx) },
  { name: "activity", schema: EndpointSchemas.activity, run: (adapter, ctx) => adapter.activity(ctx) },
  { name: "operations", schema: EndpointSchemas.operations, run: (adapter, ctx) => adapter.operations(ctx) },
  { name: "costSeries", schema: EndpointSchemas.costSeries, run: (adapter, ctx) => adapter.costSeries(ctx) },
  { name: "costByModel", schema: EndpointSchemas.costBreakdown, table: true, run: (adapter, ctx) => adapter.costByModel(ctx) },
  { name: "costByAgent", schema: EndpointSchemas.costBreakdown, table: true, run: (adapter, ctx) => adapter.costByAgent(ctx) },
  { name: "latencySeries", schema: EndpointSchemas.latencySeries, run: (adapter, ctx) => adapter.latencySeries(ctx) },
  { name: "errorsSeries", schema: EndpointSchemas.errorsSeries, run: (adapter, ctx) => adapter.errorsSeries(ctx) },
  {
    name: "recentErrors",
    schema: EndpointSchemas.recentErrors,
    table: true,
    recentErrors: true,
    run: (adapter, ctx) => adapter.recentErrors(ctx),
  },
];

function queriesFor(endpoint: EndpointCase): RawQuery[] {
  if (endpoint.recentErrors) return recentErrorQueries;
  if (endpoint.table) return tableQueries;
  return commonQueries;
}

describe("mock adapter contract conformance", () => {
  it.each(endpoints.flatMap((endpoint) =>
    queriesFor(endpoint).map((rawQuery, queryIndex) => ({ endpoint, rawQuery, queryIndex })),
  ))("$endpoint.name conforms to its response schema for query combo $queryIndex", async ({ endpoint, rawQuery }) => {
    const adapter = new MockTelemetryAdapter();
    const ctx = contextFrom(rawQuery, { table: endpoint.table, recentErrors: endpoint.recentErrors });
    const result = await endpoint.run(adapter, ctx);
    const response = ApiResponseSchema(endpoint.schema).parse(envelope(adapter, ctx, result, endpoint.usageSource));

    expect(response.meta.source).toBe("mock");
    if (endpoint.usageSource) expect(response.meta.usageSource).toBe(endpoint.usageSource);
    expect(["ok", "empty", "error"]).toContain(response.meta.status);
    expect(response.meta.status).not.toBe("error");
    expect(response.meta.granularityUsed).toMatch(/^(5m|15m|1h|6h|1d|7d)$/);
    expect(response.meta.granularityUsed.length).toBeGreaterThan(0);
    expect(new Date(response.meta.timeRange.from).getTime()).toBeLessThan(new Date(response.meta.timeRange.to).getTime());
  });
});
