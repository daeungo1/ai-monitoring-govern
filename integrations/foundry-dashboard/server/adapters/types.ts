import type {
  ActivityData,
  AgentsData,
  ConcreteGranularity,
  CostBreakdownData,
  CostSeriesData,
  DataSource,
  ErrorsSeriesData,
  Filters,
  HealthData,
  LatencySeriesData,
  MetaData,
  ModelsData,
  OperationsData,
  OverviewData,
  PlatformByModelData,
  PlatformUsageData,
  PlatformUsageSeriesData,
  RecentErrorsData,
  TableQuery,
  TimeRange,
  TokensByModelData,
  TokensSeriesData,
} from "../../shared/contracts/index.js";

export type QueryContext = {
  range: TimeRange;
  granularity: ConcreteGranularity;
  filters: Filters;
  table: TableQuery;
  includeRaw: boolean;
};

export type AdapterResult<T> = {
  data: T;
  dataAsOf: string | null;
  warnings: string[];
  costAvailable: boolean;
};

export interface TelemetryAdapter {
  source: DataSource;
  health(): Promise<AdapterResult<HealthData>>;
  meta(ctx: QueryContext): Promise<AdapterResult<MetaData>>;
  overview(ctx: QueryContext): Promise<AdapterResult<OverviewData>>;
  tokensSeries(ctx: QueryContext): Promise<AdapterResult<TokensSeriesData>>;
  tokensByModel(ctx: QueryContext): Promise<AdapterResult<TokensByModelData>>;
  platformUsage(ctx: QueryContext): Promise<AdapterResult<PlatformUsageData>>;
  platformUsageSeries(ctx: QueryContext): Promise<AdapterResult<PlatformUsageSeriesData>>;
  platformByModel(ctx: QueryContext): Promise<AdapterResult<PlatformByModelData>>;
  models(ctx: QueryContext): Promise<AdapterResult<ModelsData>>;
  agents(ctx: QueryContext): Promise<AdapterResult<AgentsData>>;
  activity(ctx: QueryContext): Promise<AdapterResult<ActivityData>>;
  operations(ctx: QueryContext): Promise<AdapterResult<OperationsData>>;
  costSeries(ctx: QueryContext): Promise<AdapterResult<CostSeriesData>>;
  costByModel(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>>;
  costByAgent(ctx: QueryContext): Promise<AdapterResult<CostBreakdownData>>;
  latencySeries(ctx: QueryContext): Promise<AdapterResult<LatencySeriesData>>;
  errorsSeries(ctx: QueryContext): Promise<AdapterResult<ErrorsSeriesData>>;
  recentErrors(ctx: QueryContext): Promise<AdapterResult<RecentErrorsData>>;
}
