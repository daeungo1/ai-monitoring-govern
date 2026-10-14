import { AzureCliCredential } from "@azure/identity";
import { MetricsQueryClient, type Metric, type MetricsQueryResult, type TimeSeriesElement } from "@azure/monitor-query";
import type {
  ConcreteGranularity,
  PlatformByModelData,
  PlatformUsageData,
  PlatformUsageSeriesData,
} from "../../shared/contracts/index.js";
import { ApiError, isThrottleError, retryAfterMs } from "../errors.js";
import { estimateCost, PRICE_SOURCE } from "../pricing.js";
import type { AdapterResult, QueryContext } from "./types.js";

const PLATFORM_METRICS = ["TotalTokens", "InputTokens", "OutputTokens", "cacheReadInputTokens", "ModelRequests"] as const;
const QUERY_FAILED_WARNING = "Azure platform metrics unavailable (RBAC, metric namespace, or Metrics API issue); returning empty platform metrics.";

type PlatformMetricName = (typeof PLATFORM_METRICS)[number];
type ModelTotals = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricGranularity(granularity: ConcreteGranularity): string {
  if (granularity === "5m") return "PT5M";
  if (granularity === "15m") return "PT15M";
  if (granularity === "1h") return "PT1H";
  if (granularity === "6h") return "PT6H";
  return "P1D";
}

async function withBackoff<T>(run: () => Promise<T>): Promise<T> {
  let delay = 250;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isThrottleError(error) || attempt === 2) throw error;
      const waitMs = retryAfterMs(error) ?? delay;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delay *= 2;
    }
  }
  return run();
}

function metricByName(result: MetricsQueryResult | null, name: PlatformMetricName): Metric | undefined {
  return result?.metrics.find((metric) => metric.name === name);
}

function metadataValue(series: TimeSeriesElement, name: string): string {
  const target = name.toLowerCase();
  return series.metadataValues?.find((item) => item.name?.toLowerCase() === target)?.value ?? "";
}

function modelName(series: TimeSeriesElement): string {
  return metadataValue(series, "ModelName") || metadataValue(series, "ModelDeploymentName") || "(unknown)";
}

function matchesModel(series: TimeSeriesElement, filters: string[] | undefined): boolean {
  if (!filters?.length) return true;
  const allowed = new Set(filters);
  return allowed.has(metadataValue(series, "ModelName")) || allowed.has(metadataValue(series, "ModelDeploymentName"));
}

function isErrorStatus(series: TimeSeriesElement): boolean {
  const status = metadataValue(series, "StatusCode");
  const numeric = Number.parseInt(status, 10);
  if (Number.isFinite(numeric)) return numeric < 200 || numeric >= 300;
  return status !== "" && status.toLowerCase() !== "success";
}

function addIgnoredFilterWarnings(ctx: QueryContext, warnings: string[]): void {
  if (ctx.filters.agent?.length) warnings.push("Agent filters do not apply to Azure platform metrics and were ignored.");
  if (ctx.filters.operation?.length) warnings.push("Operation filters do not apply to Azure platform metrics and were ignored.");
}

function emptyUsage(): PlatformUsageData {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    estCost: 0,
    errorRate: null,
    currency: "USD",
    priceSource: PRICE_SOURCE,
  };
}

export class PlatformMetricsAdapter {
  private readonly credential = new AzureCliCredential();
  private readonly client = new MetricsQueryClient(this.credential);

  constructor(private readonly resourceId?: string) {}

  async usage(ctx: QueryContext): Promise<AdapterResult<PlatformUsageData>> {
    const warnings: string[] = [];
    addIgnoredFilterWarnings(ctx, warnings);
    if (!this.resourceId) return this.wrap(emptyUsage(), ["FOUNDRY_RESOURCE_ID is not configured; platform metrics unavailable.", ...warnings]);

    const byModel = await this.query(ctx, PLATFORM_METRICS, "ModelName eq '*'", warnings);
    const status = await this.query(ctx, ["ModelRequests"], "StatusCode eq '*'", warnings);
    const rows = this.aggregateByModel(byModel, ctx.filters.model);
    const inputTokens = rows.reduce((sum, row) => sum + row.inputTokens, 0);
    const outputTokens = rows.reduce((sum, row) => sum + row.outputTokens, 0);
    const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
    const cachedTokens = rows.reduce((sum, row) => sum + row.cachedTokens, 0);
    const requests = rows.reduce((sum, row) => sum + row.requests, 0);
    const estCost = rows.reduce((sum, row) => sum + estimateCost(row.model, row.inputTokens, row.outputTokens, row.cachedTokens), 0);
    const errorRate = this.errorRate(status, ctx.filters.model);
    return this.wrap({ requests, inputTokens, outputTokens, totalTokens, cachedTokens, estCost, errorRate, currency: "USD", priceSource: PRICE_SOURCE }, warnings);
  }

  async usageSeries(ctx: QueryContext): Promise<AdapterResult<PlatformUsageSeriesData>> {
    const warnings: string[] = [];
    addIgnoredFilterWarnings(ctx, warnings);
    if (!this.resourceId) return this.wrap({ points: [] }, ["FOUNDRY_RESOURCE_ID is not configured; platform metrics unavailable.", ...warnings]);

    const result = await this.query(ctx, PLATFORM_METRICS, ctx.filters.model?.length ? "ModelName eq '*'" : undefined, warnings);
    const points = new Map<string, { ts: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }>();
    for (const metricName of PLATFORM_METRICS) {
      const metric = metricByName(result, metricName);
      for (const series of metric?.timeseries ?? []) {
        if (!matchesModel(series, ctx.filters.model)) continue;
        for (const point of series.data ?? []) {
          const ts = point.timeStamp.toISOString();
          const current = points.get(ts) ?? { ts, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          const value = asNumber(point.total);
          if (metricName === "ModelRequests") current.requests += value;
          else if (metricName === "InputTokens") current.inputTokens += value;
          else if (metricName === "OutputTokens") current.outputTokens += value;
          else if (metricName === "TotalTokens") current.totalTokens += value;
          points.set(ts, current);
        }
      }
    }
    return this.wrap({ points: [...points.values()].sort((a, b) => a.ts.localeCompare(b.ts)) }, warnings);
  }

  async byModel(ctx: QueryContext): Promise<AdapterResult<PlatformByModelData>> {
    const warnings: string[] = [];
    addIgnoredFilterWarnings(ctx, warnings);
    if (!this.resourceId) return this.wrap({ rows: [], total: 0 }, ["FOUNDRY_RESOURCE_ID is not configured; platform metrics unavailable.", ...warnings]);

    const result = await this.query(ctx, PLATFORM_METRICS, "ModelName eq '*'", warnings);
    const rows = this.aggregateByModel(result, ctx.filters.model)
      .map((row) => ({
        model: row.model,
        requests: row.requests,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens || row.inputTokens + row.outputTokens,
        estCost: estimateCost(row.model, row.inputTokens, row.outputTokens, row.cachedTokens),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    return this.wrap({ rows, total: rows.length }, warnings);
  }

  private aggregateByModel(result: MetricsQueryResult | null, filters?: string[]): ModelTotals[] {
    const rows = new Map<string, ModelTotals>();
    for (const metricName of PLATFORM_METRICS) {
      const metric = metricByName(result, metricName);
      for (const series of metric?.timeseries ?? []) {
        if (!matchesModel(series, filters)) continue;
        const model = modelName(series);
        const row = rows.get(model) ?? { model, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 };
        const value = (series.data ?? []).reduce((sum, point) => sum + asNumber(point.total), 0);
        if (metricName === "ModelRequests") row.requests += value;
        else if (metricName === "InputTokens") row.inputTokens += value;
        else if (metricName === "OutputTokens") row.outputTokens += value;
        else if (metricName === "TotalTokens") row.totalTokens += value;
        else if (metricName === "cacheReadInputTokens") row.cachedTokens += value;
        rows.set(model, row);
      }
    }
    return [...rows.values()];
  }

  private errorRate(result: MetricsQueryResult | null, filters?: string[]): number | null {
    const metric = metricByName(result, "ModelRequests");
    if (!metric) return null;
    let total = 0;
    let errors = 0;
    for (const series of metric.timeseries) {
      if (!matchesModel(series, filters)) continue;
      const count = (series.data ?? []).reduce((sum, point) => sum + asNumber(point.total), 0);
      total += count;
      if (isErrorStatus(series)) errors += count;
    }
    return total ? errors / total : null;
  }

  private async query(ctx: QueryContext, metricNames: readonly PlatformMetricName[], filter: string | undefined, warnings: string[]): Promise<MetricsQueryResult | null> {
    if (!this.resourceId) return null;
    try {
      await this.credential.getToken("https://management.azure.com/.default");
      return await withBackoff(() =>
        this.client.queryResource(this.resourceId as string, [...metricNames], {
          timespan: { startTime: new Date(ctx.range.from), endTime: new Date(ctx.range.to) },
          granularity: metricGranularity(ctx.granularity),
          aggregations: ["Total"],
          ...(filter ? { filter } : {}),
          autoAdjustTimegrain: true,
          validateDimensions: true,
        }),
      );
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : NaN;
      const message = error instanceof Error ? error.message : String(error);
      if (statusCode === 401 || /az login|azureclicredential|credentialunavailable|authentication failed|unauthorized|AADSTS/i.test(message)) {
        throw new ApiError("auth", "Azure credential unavailable — run `az login`.", 401);
      }
      if (isThrottleError(error)) warnings.push("Azure platform metrics were throttled after retries; returning partial or empty platform metrics.");
      else if (!warnings.includes(QUERY_FAILED_WARNING)) warnings.push(QUERY_FAILED_WARNING);
      return null;
    }
  }

  private wrap<T>(data: T, warnings: string[] = []): AdapterResult<T> {
    return { data, dataAsOf: new Date().toISOString(), warnings, costAvailable: true };
  }
}
