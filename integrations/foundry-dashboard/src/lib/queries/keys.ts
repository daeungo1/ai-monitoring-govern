/**
 * Centralised TanStack Query key factory.
 *
 * Keys are structured as `[endpointId, normalizedParamsObject]` so two callers
 * with equivalent params share a cache entry, and so invalidating by
 * `endpointId` is straightforward — `queryClient.invalidateQueries({
 * queryKey: queryKeys.tokensSeries.prefix() })`.
 */
import type {
  DashboardParams,
  DashboardFilters,
  TableParams,
  TimeRangeParams,
} from "@/types/dashboard";

type NormalizedRange =
  | { kind: "absolute"; from: string; to: string }
  | { kind: "preset"; preset: string }
  | { kind: "default" };

interface NormalizedFilters {
  model: string[];
  agent: string[];
  operation: string[];
}

interface NormalizedTable {
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
  topN?: number;
}

export interface NormalizedCommonParams {
  range: NormalizedRange;
  granularity: string;
  filters: NormalizedFilters;
}

export interface NormalizedTableParams extends NormalizedCommonParams {
  table: NormalizedTable;
}

function normalizeRange(range: TimeRangeParams | undefined): NormalizedRange {
  if (!range) return { kind: "default" };
  if (range.from && range.to) return { kind: "absolute", from: range.from, to: range.to };
  if (range.preset) return { kind: "preset", preset: range.preset };
  return { kind: "default" };
}

function normalizeFilters(filters: DashboardFilters | undefined): NormalizedFilters {
  return {
    model: [...(filters?.model ?? [])].sort(),
    agent: [...(filters?.agent ?? [])].sort(),
    operation: [...(filters?.operation ?? [])].sort(),
  };
}

function normalizeTable(table: TableParams | undefined): NormalizedTable {
  if (!table) return {};
  const out: NormalizedTable = {};
  if (table.page !== undefined) out.page = table.page;
  if (table.pageSize !== undefined) out.pageSize = table.pageSize;
  if (table.sort) out.sort = table.sort;
  if (table.dir) out.dir = table.dir;
  if (table.topN !== undefined) out.topN = table.topN;
  return out;
}

export function normalizeCommonParams(params: DashboardParams): NormalizedCommonParams {
  return {
    range: normalizeRange(params.range),
    granularity: params.granularity,
    filters: normalizeFilters(params.filters),
  };
}

export function normalizeTableParams(
  params: DashboardParams,
  table: TableParams | undefined,
): NormalizedTableParams {
  return {
    ...normalizeCommonParams(params),
    table: normalizeTable(table),
  };
}

/** Endpoint identifiers — keep in sync with the Fastify routes. */
export const QueryEndpoint = {
  health: "health",
  meta: "meta",
  pricing: "pricing",
  overview: "overview",
  tokensSeries: "tokens/series",
  tokensByModel: "tokens/by-model",
  platformUsage: "platform/usage",
  platformUsageSeries: "platform/usage/series",
  platformByModel: "platform/by-model",
  models: "models",
  agents: "agents",
  agentsActivity: "agents/activity",
  operations: "operations",
  costSeries: "cost/series",
  costByModel: "cost/by-model",
  costByAgent: "cost/by-agent",
  latencySeries: "latency/series",
  errorsSeries: "operations/errors/series",
  recentErrors: "operations/recent-errors",
} as const;

export type QueryEndpointId = (typeof QueryEndpoint)[keyof typeof QueryEndpoint];

interface CommonKeyMaker {
  prefix(): readonly unknown[];
  (params: DashboardParams): readonly unknown[];
}

interface TableKeyMaker {
  prefix(): readonly unknown[];
  (params: DashboardParams, table?: TableParams): readonly unknown[];
}

interface RecentErrorsKeyMaker {
  prefix(): readonly unknown[];
  (params: DashboardParams, table?: TableParams, extras?: { includeRaw?: boolean }): readonly unknown[];
}

interface StaticKeyMaker {
  prefix(): readonly unknown[];
  (): readonly unknown[];
}

function commonKey(id: QueryEndpointId): CommonKeyMaker {
  const fn = (params: DashboardParams) => [id, normalizeCommonParams(params)] as const;
  const withPrefix = fn as unknown as CommonKeyMaker;
  withPrefix.prefix = () => [id] as const;
  return withPrefix;
}

function tableKey(id: QueryEndpointId): TableKeyMaker {
  const fn = (params: DashboardParams, table?: TableParams) =>
    [id, normalizeTableParams(params, table)] as const;
  const withPrefix = fn as unknown as TableKeyMaker;
  withPrefix.prefix = () => [id] as const;
  return withPrefix;
}

function recentErrorsKey(id: QueryEndpointId): RecentErrorsKeyMaker {
  const fn = (params: DashboardParams, table?: TableParams, extras?: { includeRaw?: boolean }) =>
    [
      id,
      {
        ...normalizeTableParams(params, table),
        includeRaw: extras?.includeRaw === true,
      },
    ] as const;
  const withPrefix = fn as unknown as RecentErrorsKeyMaker;
  withPrefix.prefix = () => [id] as const;
  return withPrefix;
}

function staticKey(id: QueryEndpointId): StaticKeyMaker {
  const fn = () => [id] as const;
  const withPrefix = fn as unknown as StaticKeyMaker;
  withPrefix.prefix = () => [id] as const;
  return withPrefix;
}

export const queryKeys = {
  health: staticKey(QueryEndpoint.health),
  meta: staticKey(QueryEndpoint.meta),
  pricing: staticKey(QueryEndpoint.pricing),
  overview: commonKey(QueryEndpoint.overview),
  tokensSeries: commonKey(QueryEndpoint.tokensSeries),
  tokensByModel: tableKey(QueryEndpoint.tokensByModel),
  platformUsage: commonKey(QueryEndpoint.platformUsage),
  platformUsageSeries: commonKey(QueryEndpoint.platformUsageSeries),
  platformByModel: tableKey(QueryEndpoint.platformByModel),
  models: tableKey(QueryEndpoint.models),
  agents: tableKey(QueryEndpoint.agents),
  agentsActivity: commonKey(QueryEndpoint.agentsActivity),
  operations: commonKey(QueryEndpoint.operations),
  costSeries: commonKey(QueryEndpoint.costSeries),
  costByModel: tableKey(QueryEndpoint.costByModel),
  costByAgent: tableKey(QueryEndpoint.costByAgent),
  latencySeries: commonKey(QueryEndpoint.latencySeries),
  errorsSeries: commonKey(QueryEndpoint.errorsSeries),
  recentErrors: recentErrorsKey(QueryEndpoint.recentErrors),
} as const;
