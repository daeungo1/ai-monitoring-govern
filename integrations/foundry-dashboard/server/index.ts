import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z, type ZodTypeAny } from "zod";
import {
  ApiErrorResponseSchema,
  ApiResponseSchema,
  CommonQuerySchema,
  EndpointSchemas,
  FiltersSchema,
  PriceTableRowSchema,
  RecentErrorsQuerySchema,
  RefreshIntervalMs,
  SchemaVersion,
  TableQuerySchema,
  TableEndpointQuerySchema,
  type ApiResponse,
  type ConcreteGranularity,
  type ErrorCode,
  type Meta,
  type TimeRange,
  type UsageSource,
} from "../shared/contracts/index.js";
import { WorkspaceTelemetryAdapter, RETAIL_BASIS, RETAIL_PRICES } from "./adapters/workspace.js";
import type { AdapterResult, QueryContext, TelemetryAdapter } from "./adapters/types.js";
import { ResponseCache } from "./cache.js";
import { ApiError } from "./errors.js";
import { resolveGranularity, resolveTimeRange } from "./time.js";

try {
  process.loadEnvFile?.(".env");
} catch {
  // A missing .env never changes the source: live remains the default.
}

const PRICE_SOURCE = "Recorded request ledger · not invoice. Retail repricing is separate.";

function defaultRange(): TimeRange {
  return resolveTimeRange({ preset: "24h" });
}

function defaultMeta(source: TelemetryAdapter["source"], range = defaultRange(), granularity: ConcreteGranularity = "15m"): Meta {
  return {
    source,
    status: "error",
    dataAsOf: null,
    queryTimeMs: 0,
    granularityUsed: granularity,
    timeRange: range,
    warnings: [],
    costAvailable: false,
    priceSource: PRICE_SOURCE,
    refreshIntervalMs: RefreshIntervalMs,
    schemaVersion: SchemaVersion,
  };
}

export function resolveOpenAIResourceId(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.AZURE_OPENAI_RESOURCE_ID || undefined;
  const shared = env.FOUNDRY_RESOURCE_ID || undefined;
  if (explicit && shared && explicit.toLowerCase() !== shared.toLowerCase()) {
    throw new Error("Conflicting AZURE_OPENAI_RESOURCE_ID and FOUNDRY_RESOURCE_ID. Configure one OpenAI account.");
  }
  return explicit ?? shared;
}

function chooseAdapter(env: NodeJS.ProcessEnv): WorkspaceTelemetryAdapter {
  const source = env.DATA_SOURCE ?? "live";
  if (source !== "live" && source !== "fixture") throw new Error("DATA_SOURCE must be live or fixture. Automatic/mock fallback is disabled.");
  if (env.LOG_ANALYTICS_WORKSPACE_ID && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(env.LOG_ANALYTICS_WORKSPACE_ID)) {
    throw new Error("LOG_ANALYTICS_WORKSPACE_ID must be a workspace GUID.");
  }
  return new WorkspaceTelemetryAdapter({ source, workspaceId: env.LOG_ANALYTICS_WORKSPACE_ID,
    openAIResourceId: resolveOpenAIResourceId(env) });
}

function parseContext(rawQuery: unknown, includeTable = false, recentErrors = false): QueryContext {
  const querySchema = recentErrors ? RecentErrorsQuerySchema : includeTable ? TableEndpointQuerySchema : CommonQuerySchema;
  const parsed = querySchema.parse(rawQuery);
  const range = resolveTimeRange(parsed);
  const granularity = resolveGranularity(range, parsed.granularity);
  const filters = FiltersSchema.parse({ model: parsed.model, agent: parsed.agent, operation: parsed.operation });
  const table = TableQuerySchema.parse(parsed);
  return {
    range,
    granularity,
    filters,
    table,
    includeRaw: false,
  };
}

function statusFromData(data: unknown): "ok" | "empty" {
  const payload = data as { rows?: unknown[]; points?: unknown[]; totals?: { calls?: number }; calls?: number; requests?: number | null };
  if (payload.totals?.calls === 0) return "empty";
  if (payload.calls === 0 || payload.requests === null) return "empty";
  if (Array.isArray(payload.rows) && payload.rows.length === 0) return "empty";
  if (Array.isArray(payload.points) && payload.points.length === 0) return "empty";
  return "ok";
}

function envelope<T>(adapter: TelemetryAdapter, ctx: QueryContext, result: AdapterResult<T>, queryTimeMs: number, usageSource?: UsageSource): ApiResponse<T> {
  return {
    meta: {
      source: adapter.source,
      ...(usageSource ? { usageSource } : {}),
      status: statusFromData(result.data),
      dataAsOf: result.dataAsOf,
      queryTimeMs,
      granularityUsed: ctx.granularity,
      timeRange: ctx.range,
      warnings: result.warnings,
      costAvailable: result.costAvailable,
      priceSource: usageSource === "platform-metrics" ? "Native OpenAI metrics · cost unavailable · not invoice" : PRICE_SOURCE,
      refreshIntervalMs: RefreshIntervalMs,
      schemaVersion: SchemaVersion,
    },
    data: result.data,
  };
}

function errorEnvelope(adapter: TelemetryAdapter, code: ErrorCode, message: string, range = defaultRange(), granularity: ConcreteGranularity = "15m") {
  const meta = { ...defaultMeta(adapter.source, range, granularity), status: "error" as const, warnings: [] };
  return ApiErrorResponseSchema.parse({ meta, error: { code, message } });
}

export async function buildServer(options: { env?: NodeJS.ProcessEnv; adapter?: WorkspaceTelemetryAdapter; serveStatic?: boolean } = {}) {
  const env = options.env ?? process.env;
  const adapter = options.adapter ?? chooseAdapter(env);
  const cache = new ResponseCache(20_000);
  const serveStatic = options.serveStatic ?? env.SERVE_STATIC !== "false";
  const allowedOrigin = env.ALLOWED_ORIGIN ?? "http://127.0.0.1:5173";
  const server = Fastify({ logger: false });

  await server.register(cors, { origin: allowedOrigin, methods: ["GET"] });

  server.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    reply.header("Cache-Control", "no-store");
  });

  const sendEndpoint = <T extends ZodTypeAny>(
    schema: T,
    handler: (ctx: QueryContext) => Promise<AdapterResult<z.infer<T>>>,
    options: { table?: boolean; recentErrors?: boolean } = {},
    usageSource: UsageSource = "traces",
  ) => async (request: { query: unknown }, reply: { code: (status: number) => typeof reply; send: (body: unknown) => unknown }) => {
    let ctx: QueryContext | null = null;
    try {
      ctx = parseContext(request.query, options.table, options.recentErrors);
      const cacheKey = JSON.stringify({ source: adapter.source, url: schema.description, query: request.query, raw: ctx.includeRaw });
      const started = performance.now();
      const result = await cache.getOrRun(cacheKey, () => handler(ctx as QueryContext));
      const body = ApiResponseSchema(schema).parse(envelope(adapter, ctx, result, Math.round(performance.now() - started), usageSource));
      return reply.send(body);
    } catch (error) {
      const status = error instanceof ApiError ? error.httpStatus : error instanceof z.ZodError ? 400 : 500;
      const code: ErrorCode = error instanceof ApiError ? error.code : error instanceof z.ZodError ? "bad_request" : "upstream";
      const message = error instanceof ApiError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues.map((issue) => issue.message).join("; ")
          : "Upstream telemetry query failed.";
      return reply.code(status).send(errorEnvelope(adapter, code, code === "auth" ? "Azure credential unavailable. Check managed identity and RBAC." : message, ctx?.range, ctx?.granularity));
    }
  };

  server.get("/api/health", sendEndpoint(EndpointSchemas.health.describe("health"), () => adapter.health()));

  server.get("/api/meta", sendEndpoint(EndpointSchemas.meta.describe("meta"), (ctx) => adapter.meta(ctx)));
  server.get("/api/overview", sendEndpoint(EndpointSchemas.overview.describe("overview"), (ctx) => adapter.overview(ctx)));
  server.get("/api/tokens/series", sendEndpoint(EndpointSchemas.tokensSeries.describe("tokensSeries"), (ctx) => adapter.tokensSeries(ctx)));
  server.get("/api/tokens/by-model", sendEndpoint(EndpointSchemas.tokensByModel.describe("tokensByModel"), (ctx) => adapter.tokensByModel(ctx), { table: true }));
  server.get("/api/platform/usage", sendEndpoint(EndpointSchemas.platformUsage.describe("platformUsage"), (ctx) => adapter.platformUsage(ctx), {}, "platform-metrics"));
  server.get("/api/platform/usage/series", sendEndpoint(EndpointSchemas.platformUsageSeries.describe("platformUsageSeries"), (ctx) => adapter.platformUsageSeries(ctx), {}, "platform-metrics"));
  server.get("/api/platform/by-model", sendEndpoint(EndpointSchemas.platformByModel.describe("platformByModel"), (ctx) => adapter.platformByModel(ctx), { table: true }, "platform-metrics"));
  server.get("/api/models", sendEndpoint(EndpointSchemas.models.describe("models"), (ctx) => adapter.models(ctx), { table: true }));
  server.get("/api/agents", sendEndpoint(EndpointSchemas.agents.describe("agents"), (ctx) => adapter.agents(ctx), { table: true }));
  server.get("/api/agents/activity", sendEndpoint(EndpointSchemas.activity.describe("activity"), (ctx) => adapter.activity(ctx)));
  server.get("/api/operations", sendEndpoint(EndpointSchemas.operations.describe("operations"), (ctx) => adapter.operations(ctx)));
  server.get("/api/cost/series", sendEndpoint(EndpointSchemas.costSeries.describe("costSeries"), (ctx) => adapter.costSeries(ctx)));
  server.get("/api/cost/by-model", sendEndpoint(EndpointSchemas.costBreakdown.describe("costByModel"), (ctx) => adapter.costByModel(ctx), { table: true }));
  server.get("/api/cost/by-agent", sendEndpoint(EndpointSchemas.costBreakdown.describe("costByAgent"), (ctx) => adapter.costByAgent(ctx), { table: true }));
  server.get("/api/latency/series", sendEndpoint(EndpointSchemas.latencySeries.describe("latencySeries"), (ctx) => adapter.latencySeries(ctx)));
  server.get("/api/operations/errors/series", sendEndpoint(EndpointSchemas.errorsSeries.describe("errorsSeries"), (ctx) => adapter.errorsSeries(ctx)));
  server.get("/api/operations/recent-errors", sendEndpoint(EndpointSchemas.recentErrors.describe("recentErrors"), (ctx) => adapter.recentErrors(ctx), { table: true, recentErrors: true }));
  server.get("/api/requests", sendEndpoint(EndpointSchemas.requests.describe("requests"), (ctx) => adapter.requests(ctx), { table: true }));
  server.get("/api/streaming", sendEndpoint(EndpointSchemas.streaming.describe("streaming"), (ctx) => adapter.streaming(ctx)));
  server.get("/api/pricing", async (_request, reply) => {
    const ctx = parseContext({});
    const result: AdapterResult<{ priceSource: string; rows: typeof RETAIL_PRICES }> = { data: { priceSource: RETAIL_BASIS, rows: RETAIL_PRICES }, dataAsOf: null, warnings: ["Retail snapshot is not a recorded ledger cost or invoice."], costAvailable: false };
    return reply.send(ApiResponseSchema(z.object({ priceSource: z.string(), rows: z.array(PriceTableRowSchema) })).parse(envelope(adapter, ctx, result, 0)));
  });

  if (serveStatic) {
    const distDir = path.resolve(process.cwd(), "dist");
    await server.register(fastifyStatic, { root: distDir, prefix: "/", wildcard: false });
    // SPA fallback: client-side routes (e.g. /agents) and unknown paths return
    // index.html for GETs, while unknown /api/* paths keep a JSON 404. `wildcard:false`
    // above lets these unmatched requests reach this handler instead of the static plugin.
    server.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    });
  }

  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const server = await buildServer();
  await server.listen({ host: "0.0.0.0", port: Number.parseInt(process.env.PORT ?? "8787", 10) });
}
