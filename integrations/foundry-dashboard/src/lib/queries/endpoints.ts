/**
 * Typed TanStack Query hooks — one per Fastify endpoint.
 *
 * Every hook returns `UseQueryResult<ApiResponse<T>, ApiError>`, so callers
 * read both the typed payload (`data.data`) and the freshness/warnings
 * envelope (`data.meta`). `placeholderData: keepPreviousData` keeps panels
 * stable while the user wiggles the range/granularity/filter controls.
 *
 * Telemetry DTO types are imported from `@shared/contracts` — never redefined.
 */
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

import type {
  ActivityData,
  AgentsData,
  ApiResponse,
  CostBreakdownData,
  CostSeriesData,
  ErrorsSeriesData,
  HealthData,
  LatencySeriesData,
  MetaData,
  ModelsData,
  OperationsData,
  OverviewData,
  PlatformByModelData,
  PlatformUsageData,
  PlatformUsageSeriesData,
  PriceTableRow,
  RecentErrorsData,
  TokensByModelData,
  TokensSeriesData,
} from "@shared/contracts";

import { ApiError, apiFetch } from "@/lib/api/client";
import { QueryEndpoint, queryKeys } from "@/lib/queries/keys";
import {
  toQueryParams,
  type DashboardParams,
  type TableParams,
} from "@/types/dashboard";

/** Pricing endpoint data shape. The server composes this inline. */
export interface PricingData {
  priceSource: string;
  rows: PriceTableRow[];
}

/** Common hook options shared by every endpoint hook. */
export interface QueryHookOptions {
  /** Set false to skip fetching (e.g. controls not yet ready). Default: true. */
  enabled?: boolean;
}

export type ApiQueryResult<T> = UseQueryResult<ApiResponse<T>, ApiError>;

// ────────────────────────────────────────────────────────────────────────────
// Static (no params) endpoints
// ────────────────────────────────────────────────────────────────────────────

export function useHealth(options: QueryHookOptions = {}): ApiQueryResult<HealthData> {
  return useQuery<ApiResponse<HealthData>, ApiError>({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => apiFetch<HealthData>(`/${QueryEndpoint.health}`, {}, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useMeta(options: QueryHookOptions = {}): ApiQueryResult<MetaData> {
  return useQuery<ApiResponse<MetaData>, ApiError>({
    queryKey: queryKeys.meta(),
    queryFn: ({ signal }) => apiFetch<MetaData>(`/${QueryEndpoint.meta}`, {}, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function usePricing(options: QueryHookOptions = {}): ApiQueryResult<PricingData> {
  return useQuery<ApiResponse<PricingData>, ApiError>({
    queryKey: queryKeys.pricing(),
    queryFn: ({ signal }) => apiFetch<PricingData>(`/${QueryEndpoint.pricing}`, {}, { signal }),
    enabled: options.enabled ?? true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Common-param endpoints (time-range + granularity + filters)
// ────────────────────────────────────────────────────────────────────────────

export function useOverview(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<OverviewData> {
  return useQuery<ApiResponse<OverviewData>, ApiError>({
    queryKey: queryKeys.overview(params),
    queryFn: ({ signal }) =>
      apiFetch<OverviewData>(`/${QueryEndpoint.overview}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useTokensSeries(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<TokensSeriesData> {
  return useQuery<ApiResponse<TokensSeriesData>, ApiError>({
    queryKey: queryKeys.tokensSeries(params),
    queryFn: ({ signal }) =>
      apiFetch<TokensSeriesData>(`/${QueryEndpoint.tokensSeries}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useAgentsActivity(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<ActivityData> {
  return useQuery<ApiResponse<ActivityData>, ApiError>({
    queryKey: queryKeys.agentsActivity(params),
    queryFn: ({ signal }) =>
      apiFetch<ActivityData>(`/${QueryEndpoint.agentsActivity}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useOperations(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<OperationsData> {
  return useQuery<ApiResponse<OperationsData>, ApiError>({
    queryKey: queryKeys.operations(params),
    queryFn: ({ signal }) =>
      apiFetch<OperationsData>(`/${QueryEndpoint.operations}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCostSeries(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<CostSeriesData> {
  return useQuery<ApiResponse<CostSeriesData>, ApiError>({
    queryKey: queryKeys.costSeries(params),
    queryFn: ({ signal }) =>
      apiFetch<CostSeriesData>(`/${QueryEndpoint.costSeries}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useLatencySeries(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<LatencySeriesData> {
  return useQuery<ApiResponse<LatencySeriesData>, ApiError>({
    queryKey: queryKeys.latencySeries(params),
    queryFn: ({ signal }) =>
      apiFetch<LatencySeriesData>(`/${QueryEndpoint.latencySeries}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useErrorsSeries(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<ErrorsSeriesData> {
  return useQuery<ApiResponse<ErrorsSeriesData>, ApiError>({
    queryKey: queryKeys.errorsSeries(params),
    queryFn: ({ signal }) =>
      apiFetch<ErrorsSeriesData>(`/${QueryEndpoint.errorsSeries}`, toQueryParams(params), { signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Table endpoints (common params + page/pageSize/sort/dir/topN)
// ────────────────────────────────────────────────────────────────────────────

export interface TableHookOptions extends QueryHookOptions {
  table?: TableParams;
}

export function useTokensByModel(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<TokensByModelData> {
  return useQuery<ApiResponse<TokensByModelData>, ApiError>({
    queryKey: queryKeys.tokensByModel(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<TokensByModelData>(
        `/${QueryEndpoint.tokensByModel}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Platform metrics endpoints — authoritative Azure Monitor metrics on the
// Foundry resource. Distinct from the gen_ai trace-based endpoints above;
// callers should inspect `meta.usageSource` ('platform-metrics' | 'traces')
// to label the source in the UI. These endpoints honour the `model` filter
// but ignore `agent` / `operation` (the platform dimension is per-model).
// ────────────────────────────────────────────────────────────────────────────

export function usePlatformUsage(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<PlatformUsageData> {
  return useQuery<ApiResponse<PlatformUsageData>, ApiError>({
    queryKey: queryKeys.platformUsage(params),
    queryFn: ({ signal }) =>
      apiFetch<PlatformUsageData>(
        `/${QueryEndpoint.platformUsage}`,
        toQueryParams(params),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePlatformUsageSeries(
  params: DashboardParams,
  options: QueryHookOptions = {},
): ApiQueryResult<PlatformUsageSeriesData> {
  return useQuery<ApiResponse<PlatformUsageSeriesData>, ApiError>({
    queryKey: queryKeys.platformUsageSeries(params),
    queryFn: ({ signal }) =>
      apiFetch<PlatformUsageSeriesData>(
        `/${QueryEndpoint.platformUsageSeries}`,
        toQueryParams(params),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePlatformByModel(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<PlatformByModelData> {
  return useQuery<ApiResponse<PlatformByModelData>, ApiError>({
    queryKey: queryKeys.platformByModel(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<PlatformByModelData>(
        `/${QueryEndpoint.platformByModel}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useModels(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<ModelsData> {
  return useQuery<ApiResponse<ModelsData>, ApiError>({
    queryKey: queryKeys.models(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<ModelsData>(
        `/${QueryEndpoint.models}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useAgents(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<AgentsData> {
  return useQuery<ApiResponse<AgentsData>, ApiError>({
    queryKey: queryKeys.agents(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<AgentsData>(
        `/${QueryEndpoint.agents}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCostByModel(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<CostBreakdownData> {
  return useQuery<ApiResponse<CostBreakdownData>, ApiError>({
    queryKey: queryKeys.costByModel(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<CostBreakdownData>(
        `/${QueryEndpoint.costByModel}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCostByAgent(
  params: DashboardParams,
  options: TableHookOptions = {},
): ApiQueryResult<CostBreakdownData> {
  return useQuery<ApiResponse<CostBreakdownData>, ApiError>({
    queryKey: queryKeys.costByAgent(params, options.table),
    queryFn: ({ signal }) =>
      apiFetch<CostBreakdownData>(
        `/${QueryEndpoint.costByAgent}`,
        toQueryParams(params, { table: options.table }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Recent errors — table + optional includeRaw flag (server-gated for PII).
// ────────────────────────────────────────────────────────────────────────────

export interface RecentErrorsHookOptions extends TableHookOptions {
  /** Request raw message bodies. Server only honours this when ALLOW_RAW_CONTENT=true. */
  includeRaw?: boolean;
}

export function useRecentErrors(
  params: DashboardParams,
  options: RecentErrorsHookOptions = {},
): ApiQueryResult<RecentErrorsData> {
  return useQuery<ApiResponse<RecentErrorsData>, ApiError>({
    queryKey: queryKeys.recentErrors(params, options.table, { includeRaw: options.includeRaw }),
    queryFn: ({ signal }) =>
      apiFetch<RecentErrorsData>(
        `/${QueryEndpoint.recentErrors}`,
        toQueryParams(params, { table: options.table, includeRaw: options.includeRaw }),
        { signal },
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}
