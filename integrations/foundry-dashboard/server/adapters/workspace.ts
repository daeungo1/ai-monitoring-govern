import { DefaultAzureCredential } from "@azure/identity";
import { LogsQueryClient, LogsQueryResultStatus } from "@azure/monitor-query";
import { mapResultCodeToErrorType, type ConcreteGranularity } from "../../shared/contracts/index.js";
import { ApiError } from "../errors.js";
import { OpenAIPlatformAdapter } from "./openai-platform.js";
import { RETAIL_BASIS, RETAIL_PRICES } from "../retail-snapshot.js";
import type { AdapterResult, QueryContext, TelemetryAdapter } from "./types.js";

export { RETAIL_BASIS, RETAIL_PRICES } from "../retail-snapshot.js";
type Row = Record<string, unknown>;
type Source = "live" | "fixture";
const MAX_ROWS = 50_000;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function bool(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function identifier(value: unknown): string {
  const valueText = text(value);
  return /^[a-zA-Z0-9._-]{1,128}$/.test(valueText) ? valueText : "(unknown)";
}
const outcomes = ["success", "input_blocked", "output_blocked", "throttled", "client_error", "server_error",
  "network_error", "filter_unavailable", "stream_incomplete", "stream_cancelled",
  "rate_limit", "content_filter", "timeout", "auth_error", "cancelled", "unknown"];

export function mapDependency(row: Row) {
  const properties = typeof row.Properties === "object" && row.Properties !== null ? row.Properties as Row : {};
  const p = (key: string) => properties[`aoai.${key}`] ?? row[key];
  const ts = row.TimeGenerated instanceof Date ? row.TimeGenerated.toISOString() : text(row.TimeGenerated);
  const costReason: "price_scope_unsupported" | null = p("cost_reason") === "price_scope_unsupported"
    ? "price_scope_unsupported" : null;
  return {
    ts, model: identifier(properties["gen_ai.request.model"] ?? row.model),
    deployment: identifier(p("deployment")), modelVersion: identifier(p("model_version")),
    deploymentSku: identifier(p("deployment_sku")), input: num(p("prompt_tokens")),
    output: num(p("completion_tokens")), cached: num(p("cached_tokens")),
    estimatedCostUsd: num(p("estimated_cost_usd")), priceStatus: identifier(p("price_status")),
    costReason,
    durationMs: num(p("latency_ms")) ?? num(row.DurationMs),
    outcome: outcomes.includes(text(p("outcome"))) ? text(p("outcome")) : "unknown",
    statusCode: num(p("status_code")), streaming: bool(p("streaming")),
    ttftMs: num(p("ttft_ms")), interChunkMeanMs: num(p("inter_chunk_mean_ms")),
    streamCompleted: bool(p("stream_completed")),
  };
}
export type RequestRecord = ReturnType<typeof mapDependency>;

export function requestKql(ctx: QueryContext): string {
  // Only allowlisted numeric/identifier fields leave the workspace. Never query raw content.
  return `AppDependencies
| where TimeGenerated between (datetime(${ctx.range.from}) .. datetime(${ctx.range.to}))
| where tostring(Properties["telemetry.kind"]) == "aoai.request"
| where tostring(Properties["demo.mode"]) == "live"
| project TimeGenerated, DurationMs, model=tostring(Properties["gen_ai.request.model"]),
  deployment=tostring(Properties["aoai.deployment"]), model_version=tostring(Properties["aoai.model_version"]),
  deployment_sku=tostring(Properties["aoai.deployment_sku"]), outcome=tostring(Properties["aoai.outcome"]),
  status_code=toint(Properties["aoai.status_code"]), latency_ms=todouble(Properties["aoai.latency_ms"]),
  prompt_tokens=tolong(Properties["aoai.prompt_tokens"]), completion_tokens=tolong(Properties["aoai.completion_tokens"]),
  cached_tokens=tolong(Properties["aoai.cached_tokens"]), estimated_cost_usd=todouble(Properties["aoai.estimated_cost_usd"]),
  cost_reason=iff(tostring(Properties["aoai.cost_reason"]) == "price_scope_unsupported", "price_scope_unsupported", ""),
  price_status=tostring(Properties["aoai.price_status"]), streaming=tobool(Properties["aoai.streaming"]),
  ttft_ms=todouble(Properties["aoai.ttft_ms"]), inter_chunk_mean_ms=todouble(Properties["aoai.inter_chunk_mean_ms"]),
  stream_completed=tobool(Properties["aoai.stream_completed"])
| order by TimeGenerated asc
| take ${MAX_ROWS + 1}`;
}

function sum(rows: RequestRecord[], get: (row: RequestRecord) => number | null): number | null {
  if (!rows.length) return null;
  const values = rows.map(get);
  return values.some(value => value === null) ? null : values.reduce<number>((total, value) => total + value!, 0);
}
function total(row: RequestRecord) { return row.input === null || row.output === null ? null : row.input + row.output; }
function percentile(values: (number | null)[], pct: number): number | null {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!known.length) return null;
  const position = (known.length - 1) * pct;
  const low = Math.floor(position);
  return known[low] + (known[Math.ceil(position)] - known[low]) * (position - low);
}
function failed(row: RequestRecord) { return row.outcome !== "success"; }
function summarize(rows: RequestRecord[]) {
  const calls = rows.length;
  const tokens = sum(rows, total);
  return {
    calls, input: sum(rows, row => row.input), output: sum(rows, row => row.output),
    cached: sum(rows, row => row.cached), total: tokens, estCost: sum(rows, row => row.estimatedCostUsd),
    billedCostMtd: null, errorRate: calls ? rows.filter(failed).length / calls : null,
    successRate: calls ? rows.filter(row => !failed(row)).length / calls : null,
    p50Ms: percentile(rows.map(row => row.durationMs), 0.5), p90Ms: percentile(rows.map(row => row.durationMs), 0.9),
    p95Ms: percentile(rows.map(row => row.durationMs), 0.95), p99Ms: percentile(rows.map(row => row.durationMs), 0.99),
    avgDurationMs: calls && rows.every(row => row.durationMs !== null) ? sum(rows, row => row.durationMs)! / calls : null,
    avgTokensPerCall: tokens === null || !calls ? null : tokens / calls,
  };
}
function group(rows: RequestRecord[], key: (row: RequestRecord) => string) {
  const groups = new Map<string, RequestRecord[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const values = groups.get(groupKey) ?? [];
    values.push(row);
    groups.set(groupKey, values);
  }
  return [...groups.entries()];
}
function buckets(rows: RequestRecord[], granularity: ConcreteGranularity) {
  const minutes = { "5m": 5, "15m": 15, "1h": 60, "6h": 360, "1d": 1440, "7d": 10080 }[granularity];
  return group(rows, row => new Date(Math.floor(Date.parse(row.ts) / (minutes * 60_000)) * minutes * 60_000).toISOString());
}
function retail(row: RequestRecord) {
  if (row.costReason === "price_scope_unsupported") return null;
  const price = RETAIL_PRICES.find(card => card.model === row.model && card.version === row.modelVersion);
  if (!price || row.deploymentSku !== price.deploymentSku || row.input === null || row.input > price.maxPromptTokens
    || row.output === null || row.cached === null || row.cached > row.input) return null;
  return ((row.input - row.cached) * price.inputPer1M + row.cached * price.cachedPer1M + row.output * price.outputPer1M) / 1_000_000;
}

function fixtureRows(ctx: QueryContext): Promise<Row[]> {
  const from = Date.parse(ctx.range.from), duration = Date.parse(ctx.range.to) - from;
  return Promise.resolve(Array.from({ length: 12 }, (_, index) => ({
    TimeGenerated: new Date(from + duration * (index + 1) / 14).toISOString(),
    DurationMs: 120 + index * 15,
    Properties: {
      "telemetry.kind": "aoai.request", "demo.mode": "fixture",
      "gen_ai.request.model": RETAIL_PRICES[index % 3].model,
      "aoai.deployment": `fixture-${index % 3}`, "aoai.model_version": RETAIL_PRICES[index % 3].version,
      "aoai.deployment_sku": "GlobalStandard", "aoai.outcome": index === 10 ? "timeout" : "success",
      "aoai.status_code": index === 10 ? 0 : 200, "aoai.prompt_tokens": index === 10 ? null : 100,
      "aoai.completion_tokens": index === 10 ? null : 20, "aoai.cached_tokens": index === 10 ? null : 10,
      "aoai.estimated_cost_usd": null, "aoai.price_status": "unconfigured", "aoai.streaming": true,
      "aoai.ttft_ms": index === 10 ? null : 30, "aoai.inter_chunk_mean_ms": index === 10 ? null : 5,
      "aoai.stream_completed": index !== 10,
    },
  })));
}

export class WorkspaceTelemetryAdapter implements TelemetryAdapter {
  readonly source: Source;
  private readonly readRows: (ctx: QueryContext) => Promise<Row[]>;
  private readonly platform: OpenAIPlatformAdapter;

  constructor(options: { source: Source; workspaceId?: string; openAIResourceId?: string; readRows?: (ctx: QueryContext) => Promise<Row[]> }) {
    this.source = options.source;
    const credential = new DefaultAzureCredential();
    const client = new LogsQueryClient(credential);
    this.platform = new OpenAIPlatformAdapter(options.openAIResourceId, credential, options.source);
    this.readRows = options.readRows ?? (options.source === "fixture" ? fixtureRows : async ctx => {
      if (!options.workspaceId || !options.openAIResourceId) throw new ApiError("not_configured", "LOG_ANALYTICS_WORKSPACE_ID and FOUNDRY_RESOURCE_ID (or AZURE_OPENAI_RESOURCE_ID) are required for live mode.", 503);
      const result = await client.queryWorkspace(options.workspaceId, requestKql(ctx),
        { startTime: new Date(ctx.range.from), endTime: new Date(ctx.range.to) }, { serverTimeoutInSeconds: 60 });
      if (result.status !== LogsQueryResultStatus.Success) throw new ApiError("query_failed", "Log Analytics returned partial results; dashboard totals were not published.", 502);
      const table = result.tables[0];
      if (!table) throw new ApiError("query_failed", "Log Analytics returned no result table.", 502);
      return table.rows.map(row => Object.fromEntries(table.columnDescriptors.map((column, index) => [column.name!, row[index]])));
    });
  }

  private async rows(ctx: QueryContext) {
    if (ctx.filters.agent?.length || ctx.filters.operation?.some(operation => operation !== "chat")) {
      throw new ApiError("bad_request", "Agents and agent operations are not applicable to API-only telemetry.", 400);
    }
    try {
      const rows = await this.readRows(ctx);
      if (rows.length > MAX_ROWS) throw new ApiError("query_failed", "Range exceeds 50000 request records. Select a smaller time range; totals were not truncated.", 422);
      return rows.map(mapDependency).filter(row => !ctx.filters.model?.length || ctx.filters.model.includes(row.model));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("upstream", "Log Analytics unavailable. Check managed identity, workspace RBAC, and network access. No fixture fallback.", 502);
    }
  }
  private wrap<T>(data: T, rows: RequestRecord[] = [], warnings: string[] = []): AdapterResult<T> {
    return { data, dataAsOf: rows.at(-1)?.ts ?? null, costAvailable: false,
      warnings: ["API-only workload: agents not applicable. Billed cost is not queried; ledger estimates are not invoices.",
        ...(rows.some(row => row.input === null || row.output === null || row.cached === null) ? ["Missing usage remains null; incomplete aggregate token totals are unavailable."] : []),
        ...warnings] };
  }
  private paged<T>(rows: T[], ctx: QueryContext) {
    const key = ctx.table.sort;
    if (key) rows.sort((a, b) => {
      const left = (a as Record<string, unknown>)[key], right = (b as Record<string, unknown>)[key];
      const cmp = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
      return ctx.table.dir === "asc" ? cmp : -cmp;
    });
    return { rows: rows.slice((ctx.table.page - 1) * ctx.table.pageSize, ctx.table.page * ctx.table.pageSize), total: rows.length };
  }
  async health() {
    const ctx: QueryContext = { range: { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date().toISOString() },
      granularity: "1h", filters: {}, table: { page: 1, pageSize: 1, topN: 1, dir: "desc" }, includeRaw: false };
    const rows = await this.rows(ctx);
    return this.wrap({ source: this.source, azStatus: this.source === "live" ? "logged_in" as const : "unknown" as const, dataAsOf: rows.at(-1)?.ts ?? null }, rows);
  }
  async meta(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ source: this.source, models: [...new Set(rows.map(row => row.model))], agents: [], operations: ["chat" as const],
      projectIds: [], lastDataAt: rows.at(-1)?.ts ?? null, costAvailable: false }, rows);
  }
  async overview(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ totals: summarize(rows), deltas: {}, sparkline: buckets(rows, ctx.granularity).map(([ts, group]) => {
      const totals = summarize(group);
      return { ts, calls: totals.calls, tokens: totals.total, cost: totals.estCost, errorRate: totals.errorRate };
    }) }, rows);
  }
  async tokensSeries(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ points: buckets(rows, ctx.granularity).map(([ts, group]) => ({ ts, ...this.tokens(group) })) }, rows);
  }
  private tokens(rows: RequestRecord[]) {
    const stats = summarize(rows);
    return { input: stats.input, output: stats.output, cached: stats.cached, total: stats.total, reasoning: null,
      cacheHitRatio: stats.input === null || stats.cached === null || stats.input === 0 ? null : Math.min(1, stats.cached / stats.input) };
  }
  async tokensByModel(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ rows: group(rows, row => row.model).slice(0, ctx.table.topN).map(([model, group]) => ({
      model, ...this.tokens(group), calls: group.length,
      costPer1kInput: null, costPer1kOutput: null,
    })) }, rows);
  }
  async models(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap(this.paged(group(rows, row => row.model).map(([model, group]) => ({ model, ...summarize(group) })), ctx), rows);
  }
  async agents(_ctx?: QueryContext) { return this.wrap({ rows: [], total: 0 }); }
  async activity(_ctx?: QueryContext) { return this.wrap({ points: [] }); }
  async operations(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ rows: rows.length ? [{ operation: "chat" as const, ...summarize(rows) }] : [] }, rows);
  }
  async costSeries(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ points: buckets(rows, ctx.granularity).map(([ts, group]) => ({ ts, estCost: summarize(group).estCost, billedCost: null })),
      summary: { estTotal: summarize(rows).estCost, billedMtd: null, currency: "USD" as const, projectionMtd: null,
        costAvailable: false, priceSource: "Recorded per-request ledger · missing cost is null · not invoice" } }, rows);
  }
  async costByModel(ctx: QueryContext) {
    const rows = await this.rows(ctx), allCost = summarize(rows).estCost;
    return this.wrap({ rows: group(rows, row => row.model).slice(0, ctx.table.topN).map(([key, group]) => {
      const estCost = summarize(group).estCost;
      return { key, estCost, billedCost: null, share: estCost === null || allCost === null || !allCost ? null : estCost / allCost };
    }) }, rows);
  }
  async costByAgent(_ctx?: QueryContext) { return this.wrap({ rows: [] }); }
  async latencySeries(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ points: buckets(rows, ctx.granularity).map(([ts, group]) => ({ ts, ...summarize(group) })) }, rows);
  }
  async errorsSeries(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap({ points: buckets(rows, ctx.granularity).map(([ts, group]) => ({
      ts, total: group.length, errors: group.filter(failed).length, errorRate: summarize(group).errorRate,
    })) }, rows);
  }
  async recentErrors(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap(this.paged(rows.filter(failed).reverse().map(row => ({
      ts: row.ts, model: row.model, agent: "not applicable", operation: "chat" as const,
      resultCode: row.statusCode === null ? "unknown" : String(row.statusCode),
      errorType: mapResultCodeToErrorType(["input_blocked", "output_blocked", "content_filter"].includes(row.outcome) ? "content_filter"
        : row.outcome === "stream_cancelled" ? "cancelled" : row.statusCode ? String(row.statusCode) : row.outcome),
      durationMs: row.durationMs,
    })), ctx), rows);
  }
  async requests(ctx: QueryContext) {
    const rows = await this.rows(ctx);
    return this.wrap(this.paged(rows.map(row => ({ ...row, currentRetailCostUsd: retail(row),
      currentRetailPriceBasis: RETAIL_BASIS })), ctx), rows);
  }
  async streaming(ctx: QueryContext) {
    const rows = (await this.rows(ctx)).filter(row => row.streaming === true);
    return this.wrap({ calls: rows.length, completed: rows.filter(row => row.streamCompleted === true).length,
      incomplete: rows.filter(row => row.streamCompleted === false).length,
      completionUnknown: rows.filter(row => row.streamCompleted === null).length,
      ttftP50Ms: percentile(rows.map(row => row.ttftMs), 0.5), ttftP95Ms: percentile(rows.map(row => row.ttftMs), 0.95),
      interChunkMeanP50Ms: percentile(rows.map(row => row.interChunkMeanMs), 0.5),
      ttftKnown: rows.filter(row => row.ttftMs !== null).length,
      interChunkKnown: rows.filter(row => row.interChunkMeanMs !== null).length }, rows);
  }
  platformUsage(ctx: QueryContext) { return this.platform.usage(ctx); }
  platformUsageSeries(ctx: QueryContext) { return this.platform.usageSeries(ctx); }
  platformByModel(ctx: QueryContext) { return this.platform.byModel(ctx); }
}
