import {
  Operations,
  mapResultCodeToErrorType,
  type ActivityData,
  type AgentDimension,
  type AgentsData,
  type CostBreakdownData,
  type CostSeriesData,
  type ErrorsSeriesData,
  type LatencySeriesData,
  type MetaData,
  type ModelsData,
  type Operation,
  type OperationsData,
  type OverviewData,
  type PlatformByModelData,
  type PlatformUsageData,
  type PlatformUsageSeriesData,
  type RecentErrorsData,
  type TokensByModelData,
  type TokensSeriesData,
} from "../../shared/contracts/index.js";
import { costPer1kInput, costPer1kOutput, estimateCost, PRICE_SOURCE } from "../pricing.js";
import { enumerateBuckets, floorToBucket, granularityMs } from "../time.js";
import type { AdapterResult, QueryContext, TelemetryAdapter } from "./types.js";

type Span = {
  ts: string;
  model: string;
  agentId: string;
  agent: string;
  operation: Operation;
  input: number;
  output: number;
  cached: number;
  durationMs: number;
  success: boolean;
  resultCode: string;
  message?: string;
};

type PlatformPoint = {
  ts: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  errors: number;
};

const models = ["gpt-5.4-mini-2026-03-17", "gpt-5.4-nano-2026-03-17"];
const agents: AgentDimension[] = [
  { id: "weather-agent", name: "WeatherAgent" },
  { id: "travel-info-collector-agent", name: "TravelInfoCollectorAgent" },
  { id: "yes-no-detection-agent", name: "YesNoDetectionAgent" },
  { id: "travel-activity-recommended-agent", name: "TravelActivityRecommendedAgent" },
  { id: "travel-booking-agent", name: "TravelBookingAgent" },
  { id: "booking-info-collector-agent", name: "BookingInfoCollectorAgent" },
  { id: "(unattributed)", name: "(unattributed)" },
];

function hash(input: string): number {
  let value = 2166136261;
  for (const char of input) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rand(seed: string): number {
  return hash(seed) / 0xffffffff;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return Math.round(sorted[index]);
}

function baseResult<T>(data: T): AdapterResult<T> {
  return { data, dataAsOf: new Date().toISOString(), warnings: [], costAvailable: true };
}

function platformTotals(points: PlatformPoint[]): PlatformUsageData {
  const requests = points.reduce((sum, point) => sum + point.requests, 0);
  const inputTokens = points.reduce((sum, point) => sum + point.inputTokens, 0);
  const outputTokens = points.reduce((sum, point) => sum + point.outputTokens, 0);
  const totalTokens = points.reduce((sum, point) => sum + point.totalTokens, 0);
  const cachedTokens = points.reduce((sum, point) => sum + point.cachedTokens, 0);
  const errors = points.reduce((sum, point) => sum + point.errors, 0);
  const estCost = points.reduce((sum, point) => sum + estimateCost(point.model, point.inputTokens, point.outputTokens, point.cachedTokens), 0);
  return { requests, inputTokens, outputTokens, totalTokens, cachedTokens, estCost, errorRate: requests ? errors / requests : null, currency: "USD", priceSource: PRICE_SOURCE };
}

function ignoredPlatformFilterWarnings(ctx: QueryContext): string[] {
  const warnings: string[] = [];
  if (ctx.filters.agent?.length) warnings.push("Agent filters do not apply to Azure platform metrics and were ignored.");
  if (ctx.filters.operation?.length) warnings.push("Operation filters do not apply to Azure platform metrics and were ignored.");
  return warnings;
}

function filterSpans(spans: Span[], ctx: QueryContext): Span[] {
  const modelSet = new Set(ctx.filters.model ?? []);
  const agentSet = new Set(ctx.filters.agent ?? []);
  const operationSet = new Set(ctx.filters.operation ?? []);
  return spans.filter((span) => {
    if (modelSet.size && !modelSet.has(span.model)) return false;
    if (agentSet.size && !agentSet.has(span.agent) && !agentSet.has(span.agentId)) return false;
    if (operationSet.size && !operationSet.has(span.operation)) return false;
    return true;
  });
}

function generateSpans(ctx: QueryContext): Span[] {
  const buckets = enumerateBuckets(ctx.range, ctx.granularity);
  const step = granularityMs[ctx.granularity];
  const spans: Span[] = [];
  for (const bucket of buckets) {
    const hour = new Date(bucket).getUTCHours();
    const diurnal = 0.55 + 0.45 * Math.sin(((hour - 6) / 24) * Math.PI * 2);
    for (const agent of agents) {
      for (const operation of Operations) {
        const opWeight = operation === "chat" ? 1 : operation === "invoke_agent" ? 0.45 : 0.65;
        const count = Math.max(0, Math.round((2 + rand(`${bucket}:${agent.id}:${operation}`) * 10) * diurnal * opWeight));
        for (let i = 0; i < count; i += 1) {
          const model = models[hash(`${bucket}:${agent.id}:${operation}:${i}`) % models.length] ?? models[0];
          const r = rand(`${bucket}:${agent.id}:${operation}:${i}:err`);
          const resultCode = r < 0.006 ? "429" : r < 0.022 ? "500" : "0";
          const success = resultCode === "0";
          const isChat = operation === "chat";
          const input = isChat ? Math.round(500 + rand(`${bucket}:in:${i}`) * 3500) : 0;
          const output = isChat ? Math.round(150 + rand(`${bucket}:out:${i}`) * 1800) : 0;
          const cached = isChat ? Math.round(input * (0.05 + rand(`${bucket}:cache:${i}`) * 0.35)) : 0;
          spans.push({
            ts: new Date(new Date(bucket).getTime() + Math.floor(rand(`${bucket}:offset:${i}`) * step)).toISOString(),
            model,
            agentId: agent.id,
            agent: agent.name,
            operation,
            input,
            output,
            cached,
            durationMs: Math.round(220 + rand(`${bucket}:dur:${agent.id}:${i}`) * (operation === "execute_tool" ? 1800 : 5200)),
            success,
            resultCode,
            message: success ? undefined : resultCode === "429" ? "Mock upstream throttling event" : "Mock server error event",
          });
        }
      }
    }
  }
  return filterSpans(spans, ctx);
}

function generatePlatformPoints(ctx: QueryContext): PlatformPoint[] {
  const modelSet = new Set(ctx.filters.model ?? []);
  const buckets = enumerateBuckets(ctx.range, ctx.granularity);
  const points: PlatformPoint[] = [];
  for (const bucket of buckets) {
    const hour = new Date(bucket).getUTCHours();
    const diurnal = 0.65 + 0.35 * Math.sin(((hour - 5) / 24) * Math.PI * 2);
    const spike = rand(`${bucket}:platform:spike`) > 0.96 ? 3.8 : 1;
    for (const model of models) {
      if (modelSet.size && !modelSet.has(model)) continue;
      const modelWeight = model.includes("mini") ? 1.25 : 0.8;
      const requests = Math.round((8 + rand(`${bucket}:${model}:platform:req`) * 24) * diurnal * spike * modelWeight);
      const inputTokens = Math.round(requests * (18_000 + rand(`${bucket}:${model}:platform:in`) * 74_000));
      const outputTokens = Math.round(requests * (900 + rand(`${bucket}:${model}:platform:out`) * 4_200));
      const cachedTokens = Math.round(inputTokens * (0.08 + rand(`${bucket}:${model}:platform:cache`) * 0.3));
      const errors = Math.round(requests * (rand(`${bucket}:${model}:platform:err`) < 0.08 ? 0.035 : 0.006));
      points.push({ ts: bucket, model, requests, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens, errors });
    }
  }
  return points;
}

function totals(spans: Span[]) {
  const calls = spans.length;
  const input = spans.reduce((sum, span) => sum + span.input, 0);
  const output = spans.reduce((sum, span) => sum + span.output, 0);
  const cached = spans.reduce((sum, span) => sum + span.cached, 0);
  const total = input + output;
  const errors = spans.filter((span) => !span.success).length;
  const estCost = spans.reduce((sum, span) => sum + estimateCost(span.model, span.input, span.output, span.cached), 0);
  const durations = spans.map((span) => span.durationMs);
  return { calls, input, output, cached, total, errors, estCost, durations };
}

function byBucket<T>(spans: Span[], ctx: QueryContext, factory: (bucket: string, bucketSpans: Span[]) => T): T[] {
  const grouped = new Map<string, Span[]>();
  for (const span of spans) {
    const bucket = floorToBucket(new Date(span.ts), ctx.granularity).toISOString();
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), span]);
  }
  return enumerateBuckets(ctx.range, ctx.granularity).map((bucket) => factory(bucket, grouped.get(bucket) ?? []));
}

export class MockTelemetryAdapter implements TelemetryAdapter {
  source = "mock" as const;

  async health(): Promise<AdapterResult<{ source: "mock"; azStatus: "unknown"; dataAsOf: string | null }>> {
    return baseResult({ source: "mock", azStatus: "unknown", dataAsOf: new Date().toISOString() });
  }

  async meta(ctx: QueryContext): Promise<AdapterResult<MetaData>> {
    const spans = generateSpans(ctx);
    return baseResult({
      models,
      agents,
      operations: Operations,
      projectIds: ["mock-foundry-project"],
      lastDataAt: spans.at(-1)?.ts ?? null,
      costAvailable: true,
      source: "mock",
    });
  }

  async overview(ctx: QueryContext): Promise<AdapterResult<OverviewData>> {
    const spans = generateSpans(ctx);
    const current = totals(spans);
    const p50Ms = percentile(current.durations, 50);
    const p95Ms = percentile(current.durations, 95);
    const errorRate = current.calls ? current.errors / current.calls : 0;
    const sparkline = byBucket(spans, ctx, (ts, bucketSpans) => {
      const bucketTotals = totals(bucketSpans);
      return {
        ts,
        calls: bucketTotals.calls,
        tokens: bucketTotals.total,
        cost: bucketTotals.estCost,
        errorRate: bucketTotals.calls ? bucketTotals.errors / bucketTotals.calls : 0,
      };
    });
    return baseResult({
      totals: {
        ...current,
        billedCostMtd: current.estCost * 0.92,
        errorRate,
        successRate: 1 - errorRate,
        p50Ms,
        p95Ms,
        avgTokensPerCall: current.calls ? current.total / current.calls : 0,
      },
      deltas: { calls: 0.08, total: 0.12, estCost: 0.1, errorRate: -0.01 },
      sparkline,
    });
  }

  async tokensSeries(ctx: QueryContext): Promise<AdapterResult<TokensSeriesData>> {
    const spans = generateSpans(ctx);
    return baseResult({
      points: byBucket(spans, ctx, (ts, bucketSpans) => {
        const t = totals(bucketSpans);
        return { ts, input: t.input, output: t.output, cached: t.cached, reasoning: 0, total: t.total, cacheHitRatio: t.input ? t.cached / t.input : 0 };
      }),
    });
  }

  async tokensByModel(ctx: QueryContext): Promise<AdapterResult<TokensByModelData>> {
    const rows = this.groupRows(generateSpans(ctx), "model").map(({ key, spans }) => {
      const t = totals(spans);
      return { model: key, input: t.input, output: t.output, cached: t.cached, total: t.total, calls: t.calls, costPer1kInput: costPer1kInput(key), costPer1kOutput: costPer1kOutput(key) };
    });
    return baseResult({ rows });
  }

  async platformUsage(ctx: QueryContext): Promise<AdapterResult<PlatformUsageData>> {
    return { ...baseResult(platformTotals(generatePlatformPoints(ctx))), warnings: ignoredPlatformFilterWarnings(ctx) };
  }

  async platformUsageSeries(ctx: QueryContext): Promise<AdapterResult<PlatformUsageSeriesData>> {
    const pointsByTs = new Map<string, { ts: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
    for (const point of generatePlatformPoints(ctx)) {
      const current = pointsByTs.get(point.ts) ?? { ts: point.ts, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      current.requests += point.requests;
      current.inputTokens += point.inputTokens;
      current.outputTokens += point.outputTokens;
      current.totalTokens += point.totalTokens;
      pointsByTs.set(point.ts, current);
    }
    return { ...baseResult({ points: [...pointsByTs.values()] }), warnings: ignoredPlatformFilterWarnings(ctx) };
  }

  async platformByModel(ctx: QueryContext): Promise<AdapterResult<PlatformByModelData>> {
    const grouped = new Map<string, PlatformPoint[]>();
    for (const point of generatePlatformPoints(ctx)) grouped.set(point.model, [...(grouped.get(point.model) ?? []), point]);
    const rows = [...grouped.entries()].map(([model, modelPoints]) => {
      const t = platformTotals(modelPoints);
      return { model, requests: t.requests, inputTokens: t.inputTokens, outputTokens: t.outputTokens, totalTokens: t.totalTokens, estCost: t.estCost };
    })    .sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0));
    return { ...baseResult({ rows, total: rows.length }), warnings: ignoredPlatformFilterWarnings(ctx) };
  }

  async models(ctx: QueryContext): Promise<AdapterResult<ModelsData>> {
    const rows = this.groupRows(generateSpans(ctx), "model").map(({ key, spans }) => {
      const t = totals(spans);
      return {
        model: key,
        calls: t.calls,
        input: t.input,
        output: t.output,
        cached: t.cached,
        total: t.total,
        estCost: t.estCost,
        p50Ms: percentile(t.durations, 50),
        p90Ms: percentile(t.durations, 90),
        p95Ms: percentile(t.durations, 95),
        p99Ms: percentile(t.durations, 99),
        errorRate: t.calls ? t.errors / t.calls : 0,
        avgDurationMs: t.calls ? t.durations.reduce((sum, value) => sum + value, 0) / t.calls : 0,
      };
    });
    return baseResult({ rows, total: rows.length });
  }

  async agents(ctx: QueryContext): Promise<AdapterResult<AgentsData>> {
    const rows = this.groupRows(generateSpans(ctx), "agentId").map(({ key, spans }) => {
      const t = totals(spans);
      return {
        agentId: key,
        agent: spans[0]?.agent ?? key,
        calls: t.calls,
        input: t.input,
        output: t.output,
        cached: t.cached,
        total: t.total,
        estCost: t.estCost,
        p50Ms: percentile(t.durations, 50),
        p95Ms: percentile(t.durations, 95),
        errorRate: t.calls ? t.errors / t.calls : 0,
        operations: {
          chat: spans.filter((span) => span.operation === "chat").length,
          invoke_agent: spans.filter((span) => span.operation === "invoke_agent").length,
          execute_tool: spans.filter((span) => span.operation === "execute_tool").length,
        },
      };
    });
    return baseResult({ rows, total: rows.length });
  }

  async activity(ctx: QueryContext): Promise<AdapterResult<ActivityData>> {
    const spans = generateSpans(ctx);
    return baseResult({
      points: byBucket(spans, ctx, (ts, bucketSpans) => {
        const point: { ts: string } & Record<string, string | number> = { ts };
        for (const span of bucketSpans) point[span.agent] = Number(point[span.agent] ?? 0) + 1;
        return point;
      }),
    });
  }

  async operations(ctx: QueryContext): Promise<AdapterResult<OperationsData>> {
    const rows = Operations.map((operation) => {
      const spans = generateSpans(ctx).filter((span) => span.operation === operation);
      const t = totals(spans);
      return { operation, calls: t.calls, input: t.input, output: t.output, cached: t.cached, estCost: t.estCost, p95Ms: percentile(t.durations, 95), errorRate: t.calls ? t.errors / t.calls : 0 };
    });
    return baseResult({ rows });
  }

  async costSeries(ctx: QueryContext): Promise<AdapterResult<CostSeriesData>> {
    const spans = generateSpans(ctx);
    const points = byBucket(spans, ctx, (ts, bucketSpans) => ({ ts, estCost: totals(bucketSpans).estCost, billedCost: null }));
    const estTotal = points.reduce((sum, point) => sum + point.estCost, 0);
    return baseResult({ points, summary: { estTotal, billedMtd: estTotal * 0.92, currency: "USD", projectionMtd: estTotal * 2.1, costAvailable: true, priceSource: PRICE_SOURCE } });
  }

  async costByModel(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>> {
    return baseResult(this.costBreakdown(generateSpans(ctx), "model"));
  }

  async costByAgent(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>> {
    return baseResult(this.costBreakdown(generateSpans(ctx), "agent"));
  }

  async latencySeries(ctx: QueryContext): Promise<AdapterResult<LatencySeriesData>> {
    const spans = generateSpans(ctx);
    return baseResult({ points: byBucket(spans, ctx, (ts, bucketSpans) => ({ ts, p50Ms: percentile(bucketSpans.map((span) => span.durationMs), 50), p90Ms: percentile(bucketSpans.map((span) => span.durationMs), 90), p95Ms: percentile(bucketSpans.map((span) => span.durationMs), 95), p99Ms: percentile(bucketSpans.map((span) => span.durationMs), 99) })) });
  }

  async errorsSeries(ctx: QueryContext): Promise<AdapterResult<ErrorsSeriesData>> {
    const spans = generateSpans(ctx);
    return baseResult({ points: byBucket(spans, ctx, (ts, bucketSpans) => {
      const t = totals(bucketSpans);
      return { ts, total: t.calls, errors: t.errors, errorRate: t.calls ? t.errors / t.calls : 0 };
    }) });
  }

  async recentErrors(ctx: QueryContext): Promise<AdapterResult<RecentErrorsData>> {
    const errors = generateSpans(ctx).filter((span) => !span.success).sort((a, b) => b.ts.localeCompare(a.ts));
    const start = (ctx.table.page - 1) * ctx.table.pageSize;
    const rows = errors.slice(start, start + ctx.table.pageSize).map((span) => ({
      ts: span.ts,
      model: span.model,
      agent: span.agent,
      operation: span.operation,
      resultCode: span.resultCode,
      errorType: mapResultCodeToErrorType(span.resultCode),
      durationMs: span.durationMs,
      ...(ctx.includeRaw ? { message: span.message } : {}),
    }));
    return baseResult({ rows, total: errors.length });
  }

  private groupRows(spans: Span[], key: "model" | "agent" | "agentId"): { key: string; spans: Span[] }[] {
    const grouped = new Map<string, Span[]>();
    for (const span of spans) {
      const value = span[key];
      grouped.set(value, [...(grouped.get(value) ?? []), span]);
    }
    return [...grouped.entries()].map(([entryKey, entrySpans]) => ({ key: entryKey, spans: entrySpans }));
  }

  private costBreakdown(spans: Span[], key: "model" | "agent"): CostBreakdownData {
    const grouped = this.groupRows(spans, key);
    const total = totals(spans).estCost;
    return {
      rows: grouped.map(({ key: rowKey, spans: rowSpans }) => {
        const estCost = totals(rowSpans).estCost;
        return { key: rowKey, estCost, billedCost: null, share: total ? estCost / total : 0 };
      }),
    };
  }
}
