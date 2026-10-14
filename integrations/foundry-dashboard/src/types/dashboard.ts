/**
 * Client/UI-only types shared across the dashboard.
 *
 * Telemetry DTOs live in `@shared/contracts` — never duplicate them here.
 * This module holds:
 *  - the controls' canonical params shape (`DashboardParams`)
 *  - preset definitions + labels
 *  - table sort/pagination state
 *  - a helper that flattens `DashboardParams` (+ optional table state) into
 *    a `Record<string, string | string[]>` ready for the API client's
 *    URLSearchParams builder.
 */
import type {
  Granularity,
  Operation,
  UsageSource,
} from "@shared/contracts";

/** Preset time-range tokens exposed to the UI. Matches `TimeRangePresetSchema`. */
export type TimeRangePreset = "1h" | "6h" | "24h" | "7d" | "30d";

export interface TimeRangePresetOption {
  readonly value: TimeRangePreset;
  readonly label: string;
}

export const TIME_RANGE_PRESETS: readonly TimeRangePresetOption[] = [
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

export const DEFAULT_TIME_RANGE_PRESET: TimeRangePreset = "24h";

/**
 * UI-only labels for the `meta.usageSource` envelope flag. `platform-metrics`
 * is the authoritative Azure Monitor source that mirrors the Foundry portal
 * Monitor tab; `traces` is the gen_ai instrumented-trace pipeline.
 */
export const USAGE_SOURCE_LABELS: Readonly<Record<UsageSource, string>> = {
  "platform-metrics": "Platform metrics (authoritative)",
  traces: "Agent traces (instrumented)",
} as const;

/**
 * Time-range selection produced by the UI. Either `preset` is set, OR both
 * `from`/`to` ISO strings are set — the server validates this combination.
 */
export interface TimeRangeParams {
  preset?: TimeRangePreset;
  /** ISO-8601 with offset. */
  from?: string;
  /** ISO-8601 with offset. */
  to?: string;
}

/** Filter selections produced by the dashboard controls. Empty arrays = no filter. */
export interface DashboardFilters {
  model?: readonly string[];
  agent?: readonly string[];
  operation?: readonly Operation[];
}

/**
 * Canonical params object the dashboard controls produce and feed into every
 * data-aware hook. Hooks accept this verbatim (plus, for table endpoints, a
 * separate `table` slice).
 */
export interface DashboardParams {
  range: TimeRangeParams;
  granularity: Granularity;
  filters: DashboardFilters;
}

export const DEFAULT_DASHBOARD_PARAMS: DashboardParams = {
  range: { preset: DEFAULT_TIME_RANGE_PRESET },
  granularity: "auto",
  filters: {},
};

/** Sort/page state for table-backed endpoints. All fields optional; server applies defaults. */
export interface TableParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
  topN?: number;
}

/** Loose record passed to the API client; arrays become repeated query keys. */
export type QueryParamRecord = Record<string, string | string[] | undefined>;

function rangeToQuery(range: TimeRangeParams | undefined): QueryParamRecord {
  if (!range) return {};
  if (range.from && range.to) {
    return { from: range.from, to: range.to };
  }
  if (range.preset) {
    return { preset: range.preset };
  }
  return {};
}

function filtersToQuery(filters: DashboardFilters | undefined): QueryParamRecord {
  if (!filters) return {};
  const out: QueryParamRecord = {};
  if (filters.model && filters.model.length > 0) out.model = [...filters.model];
  if (filters.agent && filters.agent.length > 0) out.agent = [...filters.agent];
  if (filters.operation && filters.operation.length > 0) out.operation = [...filters.operation];
  return out;
}

function tableToQuery(table: TableParams | undefined): QueryParamRecord {
  if (!table) return {};
  const out: QueryParamRecord = {};
  if (table.page !== undefined) out.page = String(table.page);
  if (table.pageSize !== undefined) out.pageSize = String(table.pageSize);
  if (table.sort) out.sort = table.sort;
  if (table.dir) out.dir = table.dir;
  if (table.topN !== undefined) out.topN = String(table.topN);
  return out;
}

/**
 * Flatten `DashboardParams` (+ optional table/extras) into a query-param record.
 * Pass the result directly to the API client.
 */
export function toQueryParams(
  params: DashboardParams,
  extras: { table?: TableParams; includeRaw?: boolean } = {},
): QueryParamRecord {
  const out: QueryParamRecord = {
    ...rangeToQuery(params.range),
    granularity: params.granularity,
    ...filtersToQuery(params.filters),
    ...tableToQuery(extras.table),
  };
  if (extras.includeRaw) out.includeRaw = "true";
  return out;
}
