import type { DefaultAzureCredential } from "@azure/identity";
import type { PlatformByModelData, PlatformUsageData, PlatformUsageSeriesData } from "../../shared/contracts/index.js";
import { ApiError } from "../errors.js";
import type { AdapterResult, QueryContext } from "./types.js";

export const OPENAI_METRICS = ["AzureOpenAIRequests", "ProcessedPromptTokens", "GeneratedTokens"] as const;
type MetricPoint = { timeStamp: string; total?: number | null };
type MetricSeries = { metadatavalues?: { name: { value: string }; value: string }[]; data?: MetricPoint[] };
export type ArmMetric = { name: { value: string }; errorCode?: string; timeseries: MetricSeries[] };
type Counts = { requests: number | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
const EMPTY: Counts = { requests: null, inputTokens: null, outputTokens: null, totalTokens: null };
const PRICE_SOURCE = "Native OpenAI account metrics · no price/version/cache assumptions · not invoice";

export class OpenAIPlatformAdapter {
  constructor(private readonly resourceId: string | undefined, private readonly credential: Pick<DefaultAzureCredential, "getToken">,
    private readonly source: "live" | "fixture", private readonly fetcher: typeof fetch = fetch) {}

  private wrap<T>(data: T, warnings: string[] = []): AdapterResult<T> {
    return { data, dataAsOf: null, costAvailable: false,
      warnings: [...warnings, "Native account metrics are separate from instrumented request records; no billed cost or cached-token metric is inferred."] };
  }
  private async query(ctx: QueryContext): Promise<ArmMetric[]> {
    if (this.source === "fixture") return [];
    if (!this.resourceId) throw new ApiError("not_configured", "FOUNDRY_RESOURCE_ID (or AZURE_OPENAI_RESOURCE_ID) is required for native OpenAI metrics.", 503);
    if (ctx.filters.model?.length || ctx.filters.agent?.length || ctx.filters.operation?.length) {
      throw new ApiError("bad_request", "Native account metrics cannot be filtered by instrumented model/agent/operation. Clear filters on the Platform view.", 400);
    }
    const resourcePattern = /^\/subscriptions\/[a-f\d-]{36}\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z\d-]+$/i;
    if (!resourcePattern.test(this.resourceId)) throw new ApiError("not_configured", "AZURE_OPENAI_RESOURCE_ID must be a CognitiveServices accounts ARM resource ID.", 503);
    try {
      const token = await this.credential.getToken("https://management.azure.com/.default");
      if (!token) throw new Error("No ARM credential");
      const url = new URL(`https://management.azure.com${this.resourceId}/providers/microsoft.insights/metrics`);
      url.search = new URLSearchParams({
        "api-version": "2018-01-01", metricnamespace: "Microsoft.CognitiveServices/accounts",
        metricnames: OPENAI_METRICS.join(","), timespan: `${ctx.range.from}/${ctx.range.to}`,
        interval: { "5m": "PT5M", "15m": "PT15M", "1h": "PT1H", "6h": "PT6H", "1d": "P1D", "7d": "P1D" }[ctx.granularity],
        aggregation: "Total", "$filter": "ModelDeploymentName eq '*'", top: "100",
      }).toString();
      const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error("ARM request failed");
      const body = await response.json() as { value?: ArmMetric[] };
      if (!Array.isArray(body.value) || OPENAI_METRICS.some(name => !body.value!.some(metric => metric.name?.value === name))
        || body.value.some(metric => metric.errorCode && metric.errorCode !== "Success")) throw new Error("ARM metrics incomplete");
      return body.value;
    } catch {
      throw new ApiError("upstream", "Native OpenAI metrics unavailable. Check managed identity, Monitoring Reader, resource ID, and network access. No fixture fallback.", 502);
    }
  }
  private aggregate(metrics: ArmMetric[], deployment?: string): Counts {
    const sum = (name: string): number | null => {
      const metric = metrics.find(metric => metric.name.value === name);
      const points = (metric?.timeseries ?? []).filter(series => !deployment || this.deployment(series) === deployment)
        .flatMap(series => series.data ?? []);
      if (!points.length || points.some(point => point.total === null || point.total === undefined || !Number.isFinite(point.total))) return null;
      return points.reduce((sum, point) => sum + point.total!, 0);
    };
    const requests = sum("AzureOpenAIRequests"), inputTokens = sum("ProcessedPromptTokens"), outputTokens = sum("GeneratedTokens");
    return { requests, inputTokens, outputTokens,
      totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens };
  }
  private deployment(series: MetricSeries) {
    return series.metadatavalues?.find(value => value.name.value.toLowerCase() === "modeldeploymentname")?.value ?? "(unknown)";
  }
  async usage(ctx: QueryContext): Promise<AdapterResult<PlatformUsageData>> {
    const metrics = await this.query(ctx);
    return this.wrap({ ...(metrics.length ? this.aggregate(metrics) : EMPTY), cachedTokens: null, estCost: null,
      errorRate: null, currency: "USD", priceSource: PRICE_SOURCE },
    this.source === "fixture" ? ["Fixture mode: native ARM metrics not queried."] : []);
  }
  async usageSeries(ctx: QueryContext): Promise<AdapterResult<PlatformUsageSeriesData>> {
    const metrics = await this.query(ctx);
    const timestamps = [...new Set(metrics.flatMap(metric => metric.timeseries.flatMap(series => (series.data ?? []).map(point => point.timeStamp))))].sort();
    return this.wrap({ points: timestamps.map(ts => ({
      ts, ...this.aggregate(metrics.map(metric => ({ ...metric, timeseries: metric.timeseries.map(series => ({
        ...series, data: series.data?.filter(point => point.timeStamp === ts),
      })) }))),
    })) });
  }
  async byModel(ctx: QueryContext): Promise<AdapterResult<PlatformByModelData>> {
    const metrics = await this.query(ctx);
    const deployments = [...new Set(metrics.flatMap(metric => metric.timeseries.map(series => this.deployment(series))))].sort();
    return this.wrap({ rows: deployments.map(model => ({ model, ...this.aggregate(metrics, model), estCost: null })), total: deployments.length },
      ["Native rows are deployment names (ModelDeploymentName), not model names."]);
  }
}
