import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AzureCliCredential } from "@azure/identity";
import { LogsQueryClient, LogsQueryResultStatus, type LogsTable } from "@azure/monitor-query";
import {
  Operations,
  mapResultCodeToErrorType,
  type ActivityData,
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
import { ApiError, isAuthError, isThrottleError, retryAfterMs } from "../errors.js";
import { costPer1kInput, costPer1kOutput, estimateCost, PRICE_SOURCE } from "../pricing.js";
import { kqlTimespan } from "../time.js";
import { PlatformMetricsAdapter } from "./platform.js";
import type { AdapterResult, QueryContext, TelemetryAdapter } from "./types.js";

const execFileAsync = promisify(execFile);
type Row = Record<string, Date | string | number | boolean | null | undefined>;

export async function canUseAzureCli(): Promise<boolean> {
  try {
    const credential = new AzureCliCredential();
    await credential.getToken("https://api.loganalytics.io/.default");
    return true;
  } catch {
    return false;
  }
}

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableRows(table?: LogsTable): Row[] {
  if (!table) return [];
  return table.rows.map((row) => {
    const output: Row = {};
    table.columnDescriptors.forEach((column, index) => {
      output[column.name ?? `col${index}`] = row[index] as Row[string];
    });
    return output;
  });
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

function valuesLet(name: string, values: string[] | undefined): string {
  const safe = JSON.stringify(values ?? []);
  return `let ${name} = dynamic(${safe});`;
}

function baseKql(ctx: QueryContext): string {
  return `
let _from = datetime(${ctx.range.from});
let _to = datetime(${ctx.range.to});
${valuesLet("_models", ctx.filters.model)}
${valuesLet("_agents", ctx.filters.agent)}
${valuesLet("_operations", ctx.filters.operation)}
let _base = dependencies
| where timestamp between (_from .. _to)
| extend cd = customDimensions
| extend operation = tostring(cd["gen_ai.operation.name"])
| where operation in ("chat", "invoke_agent", "execute_tool")
| extend model = coalesce(tostring(cd["gen_ai.request.model"]), tostring(cd["gen_ai.response.model"]))
| extend agentIdRaw = tostring(cd["gen_ai.agent.id"])
| extend agentNameRaw = tostring(cd["gen_ai.agent.name"])
| extend agentId = iff(isempty(agentIdRaw), "(unattributed)", agentIdRaw)
| extend agent = iff(isempty(agentNameRaw), "(unattributed)", agentNameRaw)
| extend projectId = tostring(cd["gen_ai.azure_ai_project.id"])
| extend input = coalesce(todouble(cd["gen_ai.usage.input_tokens"]), 0.0)
| extend output = coalesce(todouble(cd["gen_ai.usage.output_tokens"]), 0.0)
| extend cached = coalesce(todouble(cd["gen_ai.usage.cached_tokens"]), 0.0)
| extend durationMs = coalesce(todouble(duration), 0.0)
| extend ok = tobool(success)
| extend result = tostring(resultCode)
| where array_length(_models) == 0 or set_has_element(_models, model)
| where array_length(_agents) == 0 or set_has_element(_agents, agent) or set_has_element(_agents, agentId)
| where array_length(_operations) == 0 or set_has_element(_operations, operation);
`;
}

function withCostRows(rows: Row[], modelKey = "model"): Row[] {
  return rows.map((row) => ({
    ...row,
    estCost: estimateCost(asString(row[modelKey]), asNumber(row.input), asNumber(row.output), asNumber(row.cached)),
  }));
}

export class AzureTelemetryAdapter implements TelemetryAdapter {
  source = "live" as const;
  private readonly credential = new AzureCliCredential();
  private readonly client = new LogsQueryClient(this.credential);
  private dimensionsCache: { expiresAt: number; value: MetaData } | null = null;
  private readonly platformAdapter: PlatformMetricsAdapter;

  constructor(private readonly resourceId: string, private readonly subscriptionId?: string, foundryResourceId?: string) {
    this.platformAdapter = new PlatformMetricsAdapter(foundryResourceId);
  }

  async health(): Promise<AdapterResult<{ source: "live"; azStatus: "logged_in" | "logged_out"; dataAsOf: string | null }>> {
    try {
      await this.credential.getToken("https://api.loganalytics.io/.default");
      const last = await this.queryRows("dependencies | summarize lastDataAt=max(timestamp)", { duration: "P30D" });
      return this.wrap({ source: "live", azStatus: "logged_in", dataAsOf: asString(last[0]?.lastDataAt) || null });
    } catch (error) {
      if (isAuthError(error)) return this.wrap({ source: "live", azStatus: "logged_out", dataAsOf: null }, ["Azure credential unavailable — run `az login`."]);
      throw error;
    }
  }

  async meta(ctx: QueryContext): Promise<AdapterResult<MetaData>> {
    return this.wrap(await this.getDimensions(ctx));
  }

  async overview(ctx: QueryContext): Promise<AdapterResult<OverviewData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count(), input=sum(input), output=sum(output), cached=sum(cached), errors=countif(ok == false), p50Ms=percentile(durationMs, 50), p95Ms=percentile(durationMs, 95)
`);
    const row = rows[0] ?? {};
    const costRows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize input=sum(input), output=sum(output), cached=sum(cached) by model
`));
    const estCost = costRows.reduce((sum, item) => sum + asNumber(item.estCost), 0);
    const calls = asNumber(row.calls);
    const total = asNumber(row.input) + asNumber(row.output);
    const errors = asNumber(row.errors);
    const sparklineRows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count(), input=sum(input), output=sum(output), cached=sum(cached), errors=countif(ok == false) by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)}), model
| order by ts asc
`));
    const sparkline = new Map<string, { ts: string; calls: number; tokens: number; cost: number; errors: number }>();
    for (const item of sparklineRows) {
      const ts = asString(item.ts);
      const current = sparkline.get(ts) ?? { ts, calls: 0, tokens: 0, cost: 0, errors: 0 };
      current.calls += asNumber(item.calls);
      current.tokens += asNumber(item.input) + asNumber(item.output);
      current.cost += asNumber(item.estCost);
      current.errors += asNumber(item.errors);
      sparkline.set(ts, current);
    }
    const billed = await this.getBilledCost();
    const warnings = billed.warning ? [billed.warning] : [];
    return this.wrap({
      totals: {
        calls,
        input: asNumber(row.input),
        output: asNumber(row.output),
        cached: asNumber(row.cached),
        total,
        estCost,
        billedCostMtd: billed.value,
        errorRate: calls ? errors / calls : 0,
        successRate: calls ? 1 - errors / calls : 1,
        p50Ms: asNumber(row.p50Ms),
        p95Ms: asNumber(row.p95Ms),
        avgTokensPerCall: calls ? total / calls : 0,
      },
      deltas: {},
      sparkline: [...sparkline.values()].map((item) => ({
        ts: asString(item.ts),
        calls: asNumber(item.calls),
        tokens: asNumber(item.tokens),
        cost: asNumber(item.cost),
        errorRate: asNumber(item.calls) ? asNumber(item.errors) / asNumber(item.calls) : 0,
      })),
    }, warnings, billed.available);
  }

  async tokensSeries(ctx: QueryContext): Promise<AdapterResult<TokensSeriesData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize input=sum(input), output=sum(output), cached=sum(cached) by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)})
| order by ts asc
`);
    return this.wrap({ points: rows.map((row) => {
      const input = asNumber(row.input);
      const output = asNumber(row.output);
      const cached = asNumber(row.cached);
      return { ts: asString(row.ts), input, output, cached, reasoning: 0, total: input + output, cacheHitRatio: input ? cached / input : 0 };
    }) });
  }

  async tokensByModel(ctx: QueryContext): Promise<AdapterResult<TokensByModelData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize input=sum(input), output=sum(output), cached=sum(cached), calls=count() by model
| order by input desc
`);
    return this.wrap({ rows: rows.map((row) => ({ model: asString(row.model), input: asNumber(row.input), output: asNumber(row.output), cached: asNumber(row.cached), total: asNumber(row.input) + asNumber(row.output), calls: asNumber(row.calls), costPer1kInput: costPer1kInput(asString(row.model)), costPer1kOutput: costPer1kOutput(asString(row.model)) })) });
  }

  async platformUsage(ctx: QueryContext): Promise<AdapterResult<PlatformUsageData>> {
    return this.platformAdapter.usage(ctx);
  }

  async platformUsageSeries(ctx: QueryContext): Promise<AdapterResult<PlatformUsageSeriesData>> {
    return this.platformAdapter.usageSeries(ctx);
  }

  async platformByModel(ctx: QueryContext): Promise<AdapterResult<PlatformByModelData>> {
    return this.platformAdapter.byModel(ctx);
  }

  async models(ctx: QueryContext): Promise<AdapterResult<ModelsData>> {
    await this.validateFilters(ctx);
    const rows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count(), input=sum(input), output=sum(output), cached=sum(cached), errors=countif(ok == false), p50Ms=percentile(durationMs, 50), p90Ms=percentile(durationMs, 90), p95Ms=percentile(durationMs, 95), p99Ms=percentile(durationMs, 99), avgDurationMs=avg(durationMs) by model
| order by calls desc
`));
    const mapped = rows.map((row) => ({ model: asString(row.model), calls: asNumber(row.calls), input: asNumber(row.input), output: asNumber(row.output), cached: asNumber(row.cached), total: asNumber(row.input) + asNumber(row.output), estCost: asNumber(row.estCost), p50Ms: asNumber(row.p50Ms), p90Ms: asNumber(row.p90Ms), p95Ms: asNumber(row.p95Ms), p99Ms: asNumber(row.p99Ms), errorRate: asNumber(row.calls) ? asNumber(row.errors) / asNumber(row.calls) : 0, avgDurationMs: asNumber(row.avgDurationMs) }));
    return this.wrap({ rows: mapped, total: mapped.length });
  }

  async agents(ctx: QueryContext): Promise<AdapterResult<AgentsData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count(), input=sum(input), output=sum(output), cached=sum(cached), errors=countif(ok == false), p50Ms=percentile(durationMs, 50), p95Ms=percentile(durationMs, 95), chat=countif(operation=="chat"), invoke_agent=countif(operation=="invoke_agent"), execute_tool=countif(operation=="execute_tool") by agentId, agent, model
`);
    const grouped = new Map<string, Row>();
    for (const row of withCostRows(rows)) {
      const key = `${asString(row.agentId)}\u0000${asString(row.agent)}`;
      const current = grouped.get(key) ?? { agentId: row.agentId, agent: row.agent, calls: 0, input: 0, output: 0, cached: 0, estCost: 0, errors: 0, p50Ms: 0, p95Ms: 0, chat: 0, invoke_agent: 0, execute_tool: 0 };
      for (const field of ["calls", "input", "output", "cached", "estCost", "errors", "chat", "invoke_agent", "execute_tool"] as const) current[field] = asNumber(current[field]) + asNumber(row[field]);
      current.p50Ms = Math.max(asNumber(current.p50Ms), asNumber(row.p50Ms));
      current.p95Ms = Math.max(asNumber(current.p95Ms), asNumber(row.p95Ms));
      grouped.set(key, current);
    }
    const mapped = [...grouped.values()].map((row) => ({ agentId: asString(row.agentId), agent: asString(row.agent), calls: asNumber(row.calls), input: asNumber(row.input), output: asNumber(row.output), cached: asNumber(row.cached), total: asNumber(row.input) + asNumber(row.output), estCost: asNumber(row.estCost), p50Ms: asNumber(row.p50Ms), p95Ms: asNumber(row.p95Ms), errorRate: asNumber(row.calls) ? asNumber(row.errors) / asNumber(row.calls) : 0, operations: { chat: asNumber(row.chat), invoke_agent: asNumber(row.invoke_agent), execute_tool: asNumber(row.execute_tool) } }));
    return this.wrap({ rows: mapped, total: mapped.length });
  }

  async activity(ctx: QueryContext): Promise<AdapterResult<ActivityData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count() by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)}), agent
| order by ts asc
`);
    const points = new Map<string, { ts: string } & Record<string, string | number>>();
    for (const row of rows) {
      const ts = asString(row.ts);
      const point = points.get(ts) ?? { ts };
      point[asString(row.agent)] = asNumber(row.calls);
      points.set(ts, point);
    }
    return this.wrap({ points: [...points.values()] });
  }

  async operations(ctx: QueryContext): Promise<AdapterResult<OperationsData>> {
    await this.validateFilters(ctx);
    const rows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize calls=count(), input=sum(input), output=sum(output), cached=sum(cached), errors=countif(ok == false), p95Ms=percentile(durationMs, 95) by operation, model
`));
    const grouped = new Map<Operation, Row>();
    for (const row of rows) {
      const operation = asString(row.operation) as Operation;
      const current = grouped.get(operation) ?? { operation, calls: 0, input: 0, output: 0, cached: 0, errors: 0, estCost: 0, p95Ms: 0 };
      for (const field of ["calls", "input", "output", "cached", "errors", "estCost"] as const) current[field] = asNumber(current[field]) + asNumber(row[field]);
      current.p95Ms = Math.max(asNumber(current.p95Ms), asNumber(row.p95Ms));
      grouped.set(operation, current);
    }
    return this.wrap({ rows: Operations.map((operation) => {
      const row = grouped.get(operation) ?? { operation };
      return { operation, calls: asNumber(row.calls), input: asNumber(row.input), output: asNumber(row.output), cached: asNumber(row.cached), estCost: asNumber(row.estCost), p95Ms: asNumber(row.p95Ms), errorRate: asNumber(row.calls) ? asNumber(row.errors) / asNumber(row.calls) : 0 };
    }) });
  }

  async costSeries(ctx: QueryContext): Promise<AdapterResult<CostSeriesData>> {
    await this.validateFilters(ctx);
    const rows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize input=sum(input), output=sum(output), cached=sum(cached) by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)}), model
| order by ts asc
`));
    const points = new Map<string, { ts: string; estCost: number; billedCost: null }>();
    for (const row of rows) {
      const ts = asString(row.ts);
      const current = points.get(ts) ?? { ts, estCost: 0, billedCost: null };
      current.estCost += asNumber(row.estCost);
      points.set(ts, current);
    }
    const billed = await this.getBilledCost();
    const estTotal = [...points.values()].reduce((sum, point) => sum + point.estCost, 0);
    return this.wrap({ points: [...points.values()], summary: { estTotal, billedMtd: billed.value, currency: "USD", projectionMtd: estTotal ? estTotal * 2 : null, costAvailable: billed.available, priceSource: PRICE_SOURCE } }, billed.warning ? [billed.warning] : [], billed.available);
  }

  async costByModel(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>> {
    return this.costBreakdown(ctx, "model");
  }

  async costByAgent(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>> {
    return this.costBreakdown(ctx, "agent");
  }

  async latencySeries(ctx: QueryContext): Promise<AdapterResult<LatencySeriesData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize p50Ms=percentile(durationMs, 50), p90Ms=percentile(durationMs, 90), p95Ms=percentile(durationMs, 95), p99Ms=percentile(durationMs, 99) by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)})
| order by ts asc
`);
    return this.wrap({ points: rows.map((row) => ({ ts: asString(row.ts), p50Ms: asNumber(row.p50Ms), p90Ms: asNumber(row.p90Ms), p95Ms: asNumber(row.p95Ms), p99Ms: asNumber(row.p99Ms) })) });
  }

  async errorsSeries(ctx: QueryContext): Promise<AdapterResult<ErrorsSeriesData>> {
    await this.validateFilters(ctx);
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize total=count(), errors=countif(ok == false) by ts=bin(timestamp, ${kqlTimespan(ctx.granularity)})
| order by ts asc
`);
    return this.wrap({ points: rows.map((row) => ({ ts: asString(row.ts), total: asNumber(row.total), errors: asNumber(row.errors), errorRate: asNumber(row.total) ? asNumber(row.errors) / asNumber(row.total) : 0 })) });
  }

  async recentErrors(ctx: QueryContext): Promise<AdapterResult<RecentErrorsData>> {
    await this.validateFilters(ctx);
    const rawProjection = ctx.includeRaw ? ', message=tostring(name)' : "";
    const rows = await this.query(ctx, `
${baseKql(ctx)}
_base
| where ok == false
| order by timestamp desc
| extend rn=row_number()
| where rn between (${(ctx.table.page - 1) * ctx.table.pageSize + 1} .. ${ctx.table.page * ctx.table.pageSize})
| project ts=timestamp, model, agent, operation, resultCode=result, durationMs${rawProjection}
`);
    const countRows = await this.query(ctx, `${baseKql(ctx)}\n_base | where ok == false | count`);
    return this.wrap({ rows: rows.map((row) => ({ ts: asString(row.ts), model: asString(row.model), agent: asString(row.agent), operation: asString(row.operation) as Operation, resultCode: asString(row.resultCode), errorType: mapResultCodeToErrorType(asString(row.resultCode)), durationMs: asNumber(row.durationMs), ...(ctx.includeRaw ? { message: asString(row.message) } : {}) })), total: asNumber(countRows[0]?.Count ?? countRows[0]?.count_) });
  }

  private async costBreakdown(ctx: QueryContext, key: "model" | "agent"): Promise<AdapterResult<CostBreakdownData>> {
    await this.validateFilters(ctx);
    const groupKey = key === "agent" ? "agent" : "model";
    const rows = withCostRows(await this.query(ctx, `
${baseKql(ctx)}
_base
| summarize input=sum(input), output=sum(output), cached=sum(cached) by ${groupKey}, model
`));
    const grouped = new Map<string, number>();
    for (const row of rows) {
      const rowKey = asString(row[groupKey]);
      grouped.set(rowKey, (grouped.get(rowKey) ?? 0) + asNumber(row.estCost));
    }
    const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
    return this.wrap({ rows: [...grouped.entries()].map(([rowKey, estCost]) => ({ key: rowKey, estCost, billedCost: null, share: total ? estCost / total : 0 })) });
  }

  private async query(ctx: QueryContext, kql: string): Promise<Row[]> {
    return this.queryRows(kql, { startTime: new Date(ctx.range.from), endTime: new Date(ctx.range.to) });
  }

  private async queryRows(kql: string, timespan: { startTime: Date; endTime: Date } | { duration: string }): Promise<Row[]> {
    try {
      const result = await withBackoff(() => this.client.queryResource(this.resourceId, kql, timespan, { serverTimeoutInSeconds: 60 }));
      if (result.status === LogsQueryResultStatus.PartialFailure) return tableRows(result.partialTables[0]);
      if (result.status === LogsQueryResultStatus.Success) return tableRows(result.tables[0]);
      throw new ApiError("query_failed", "Azure Monitor query failed.", 502);
    } catch (error) {
      if (isAuthError(error)) throw new ApiError("auth", "Azure credential unavailable — run `az login`.", 401);
      if (isThrottleError(error)) throw new ApiError("throttled", "Azure Monitor query was throttled. Retry after the indicated interval.", 429);
      throw error;
    }
  }

  private async getDimensions(ctx: QueryContext): Promise<MetaData> {
    if (this.dimensionsCache && this.dimensionsCache.expiresAt > Date.now()) return this.dimensionsCache.value;
    const rows = await this.query(ctx, `
${baseKql({ ...ctx, filters: {} })}
_base
| summarize models=make_set(model, 200), agents=make_set(pack("id", agentId, "name", agent), 200), operations=make_set(operation, 20), projectIds=make_set(projectId, 100), lastDataAt=max(timestamp)
`);
    const row = rows[0] ?? {};
    const value: MetaData = {
      models: Array.isArray(row.models) ? row.models.map(String).filter(Boolean) : [],
      agents: Array.isArray(row.agents) ? row.agents.map((entry) => {
        const agent = entry as { id?: unknown; name?: unknown };
        return { id: asString(agent.id) || "(unattributed)", name: asString(agent.name) || "(unattributed)" };
      }) : [],
      operations: (Array.isArray(row.operations) ? row.operations.filter((item): item is Operation => Operations.includes(item as Operation)) : Operations),
      projectIds: Array.isArray(row.projectIds) ? row.projectIds.map(String).filter(Boolean) : [],
      lastDataAt: asString(row.lastDataAt) || null,
      costAvailable: true,
      source: "live",
    };
    this.dimensionsCache = { expiresAt: Date.now() + 60_000, value };
    return value;
  }

  private async validateFilters(ctx: QueryContext): Promise<void> {
    const dimensions = await this.getDimensions(ctx);
    const modelsSet = new Set(dimensions.models);
    const agentSet = new Set(dimensions.agents.flatMap((agent) => [agent.id, agent.name]));
    const invalidModel = (ctx.filters.model ?? []).find((model) => !modelsSet.has(model));
    if (invalidModel) throw new ApiError("bad_request", `Unknown model filter: ${invalidModel}`, 400);
    const invalidAgent = (ctx.filters.agent ?? []).find((agent) => !agentSet.has(agent));
    if (invalidAgent) throw new ApiError("bad_request", `Unknown agent filter: ${invalidAgent}`, 400);
  }

  private async getBilledCost(): Promise<{ value: number | null; available: boolean; warning?: string }> {
    if (!this.subscriptionId) return { value: null, available: false, warning: "Azure subscription ID is not configured; billed cost unavailable." };
    try {
      const scope = `/subscriptions/${this.subscriptionId}`;
      const { stdout } = await execFileAsync("az", [
        "costmanagement",
        "query",
        "--type",
        "ActualCost",
        "--scope",
        scope,
        "--timeframe",
        "MonthToDate",
        "--dataset-aggregation",
        "{\"totalCost\":{\"name\":\"Cost\",\"function\":\"Sum\"}}",
        "-o",
        "json",
      ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { rows?: unknown[][]; properties?: { rows?: unknown[][] } };
      const rows = parsed.rows ?? parsed.properties?.rows ?? [];
      const value = rows.length ? asNumber(rows[0]?.[0]) : null;
      return { value, available: value !== null };
    } catch {
      return { value: null, available: false, warning: "Azure Cost Management unavailable (RBAC or CLI issue); estimated cost still returned." };
    }
  }

  private wrap<T>(data: T, warnings: string[] = [], costAvailable = true): AdapterResult<T> {
    return { data, dataAsOf: new Date().toISOString(), warnings, costAvailable };
  }
}
