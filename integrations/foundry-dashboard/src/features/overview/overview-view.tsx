import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { useOverview, usePlatformUsage, usePlatformUsageSeries } from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";

import { Sparkline } from "@/components/charts/sparkline";
import { PlatformRequestsChart } from "@/components/charts/platform-requests-chart";
import { StatCard } from "@/features/_shared/stat-card";
import { UsageSourceBadge } from "@/features/_shared/usage-source-badge";
import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import {
  formatAbsoluteTime,
  formatCost,
  formatInt,
  formatMs,
  formatPct,
  formatPct0,
  formatTokens,
} from "@/features/_shared/format";
import { tickFormatterFor } from "@/features/_shared/tick-formatter";
import { completeSum } from "@/features/_shared/aggregate";

/** A grid of KPI cards driven by `useOverview`. */
export function OverviewKpiGrid() {
  const { params } = useDashboardParams();
  const q = useOverview(params);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <PanelSkeleton key={i} className="h-[78px]" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  }

  const data = q.data?.data;
  if (!data) return <PanelEmpty />;

  const { totals, deltas } = data;
  const d = (k: string): number | undefined => {
    const v = deltas?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <StatCard
        label="Calls"
        value={formatInt(totals.calls)}
        delta={d("calls")}
        hint={`${formatPct0(totals.successRate)} success`}
      />
      <StatCard
        label="Total tokens"
        value={formatTokens(totals.total)}
        delta={d("total")}
        hint={
          <>
            {formatTokens(totals.input)} in · {formatTokens(totals.output)} out ·{" "}
            {formatTokens(totals.cached)} cached
          </>
        }
      />
      <StatCard
        label="Est. cost"
        value={formatCost(totals.estCost)}
        delta={d("estCost")}
        hint="token × price"
      />
      <StatCard
        label="Billed (MTD)"
        value={
          totals.billedCostMtd === null ? (
            <span className="text-base font-medium text-muted-foreground">unavailable</span>
          ) : (
            formatCost(totals.billedCostMtd)
          )
        }
        delta={d("billedCostMtd")}
        hint={totals.billedCostMtd === null ? "Cost Mgmt RBAC" : "Azure Cost Management"}
      />
      <StatCard
        label="Error rate"
        value={formatPct(totals.errorRate)}
        delta={d("errorRate")}
        invertDelta
        hint={`${formatPct0(totals.successRate)} ok`}
      />
      <StatCard
        label="Success rate"
        value={formatPct(totals.successRate)}
        delta={d("successRate")}
      />
      <StatCard
        label="p50 latency"
        value={formatMs(totals.p50Ms)}
        delta={d("p50Ms")}
        invertDelta
      />
      <StatCard
        label="p95 latency"
        value={formatMs(totals.p95Ms)}
        delta={d("p95Ms")}
        invertDelta
      />
      <StatCard
        label="Avg tokens/call"
        value={formatTokens(totals.avgTokensPerCall)}
        delta={d("avgTokensPerCall")}
      />
      <StatCard
        label="Avg cost/call"
        value={formatCost(totals.calls > 0 && totals.estCost !== null ? totals.estCost / totals.calls : null)}
        hint="estimated"
      />
    </div>
  );
}

/** Compact freshness/source line, used at the top of the Overview. */
export function OverviewFreshness() {
  const { params } = useDashboardParams();
  const q = useOverview(params);
  const meta = q.data?.meta;
  const isLive = meta?.source === "live";
  const range = meta?.timeRange;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <Badge variant={isLive ? "success" : "warning"} className="h-5 px-1.5 text-[10px]">
        {meta ? (isLive ? "Live" : "Fixture") : "Unavailable"}
      </Badge>
      {range ? (
        <span title={`${range.from} → ${range.to}`}>
          {formatAbsoluteTime(range.from)} → {formatAbsoluteTime(range.to)}
        </span>
      ) : null}
      <span>·</span>
      <span>data as of {formatAbsoluteTime(meta?.dataAsOf)}</span>
      {meta?.granularityUsed ? (
        <>
          <span>·</span>
          <span>bucket {meta.granularityUsed}</span>
        </>
      ) : null}
      {meta?.queryTimeMs !== undefined ? (
        <>
          <span>·</span>
          <span>{Math.round(meta.queryTimeMs)}ms query</span>
        </>
      ) : null}
    </div>
  );
}

/** Mini-trend strip — 4 sparklines pulled from overview.sparkline. */
export function OverviewTrendStrip() {
  const { params } = useDashboardParams();
  const q = useOverview(params);

  if (q.isPending) return <PanelSkeleton className="h-[110px]" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;

  const points = q.data?.data.sparkline ?? [];
  if (points.length === 0) return <PanelEmpty />;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <TrendCard title="Calls" data={points} dataKey="calls" formatter={formatInt} />
      <TrendCard title="Tokens" data={points} dataKey="tokens" formatter={formatTokens} />
      <TrendCard title="Est. cost" data={points} dataKey="cost" formatter={formatCost} />
      <TrendCard title="Error rate" data={points} dataKey="errorRate" formatter={formatPct} />
    </div>
  );
}

interface SparkPt {
  ts: string;
  calls: number;
  tokens: number | null;
  cost: number | null;
  errorRate: number | null;
}

function TrendCard({
  title,
  data,
  dataKey,
  formatter,
}: {
  title: string;
  data: readonly SparkPt[];
  dataKey: "calls" | "tokens" | "cost" | "errorRate";
  formatter: (v: unknown) => string;
}) {
  const last = data[data.length - 1]?.[dataKey];
  return (
    <Card className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="num text-xs font-medium">{formatter(last)}</span>
      </div>
      <Sparkline
        data={data as unknown as { ts: string; [k: string]: unknown }[]}
        dataKey={dataKey}
        tooltipFormatter={formatter}
        className="h-14 w-full"
      />
    </Card>
  );
}

/** Full Overview view body. */
export function OverviewView() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Authoritative usage</CardTitle>
            <AuthoritativeUsageSource />
          </div>
          <p className="text-xs text-muted-foreground">
            Azure Monitor platform metrics on the Foundry resource — all
            traffic. Matches the Azure portal Monitor tab. See the Platform
            Usage view for the full breakdown.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <AuthoritativeUsageBand />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Requests over time</CardTitle>
            <AuthoritativeUsageSource />
          </div>
          <p className="text-xs text-muted-foreground">
            Authoritative model-request volume across the selected window —
            your headline traffic signal. Watch for spikes, gaps, and sustained
            growth toward capacity limits.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <RequestsOverTimePanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Instrumented API requests (subset)</CardTitle>
            <TraceUsageSource />
          </div>
          <p
            className="text-xs text-muted-foreground"
            title="Only API calls with gen_ai OpenTelemetry instrumentation appear here. They are a subset of total traffic to the Foundry resource — for the authoritative totals, see the band above (or the Platform Usage view)."
          >
            AppDependencies aoai.request live records only. Agents are not applicable.
            Instrumented coverage can differ from native OpenAI account counters.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <OverviewKpiGrid />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Trends</CardTitle>
            <TraceUsageSource />
          </div>
          <p className="text-xs text-muted-foreground">
            Trace-derived sparklines (instrumented subset).
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <OverviewTrendStrip />
        </CardContent>
      </Card>

      <OverviewFooterFreshness />
    </div>
  );
}

function OverviewFooterFreshness() {
  return (
    <div className="flex justify-end">
      <OverviewFreshness />
    </div>
  );
}

function AuthoritativeUsageSource() {
  const { params } = useDashboardParams();
  const q = usePlatformUsage(params);
  return (
    <UsageSourceBadge
      source={q.data?.meta?.usageSource}
      hint="· matches Foundry Monitor"
    />
  );
}

function TraceUsageSource() {
  const { params } = useDashboardParams();
  const q = useOverview(params);
  // Overview is a trace-derived endpoint; fall back to 'traces' if meta omits it.
  const source = q.data?.meta?.usageSource ?? "traces";
  return (
    <UsageSourceBadge
      source={source}
      hint="· subset of total traffic"
    />
  );
}

/** Authoritative request-volume trend for the Overview headline panel. */
function RequestsOverTimePanel() {
  const { params } = useDashboardParams();
  const q = usePlatformUsageSeries(params);

  const summary = useMemo(() => {
    const points = q.data?.data.points ?? [];
    if (points.length === 0) return null;
    const total = completeSum(points.map(point => point.requests));
    const known = points.flatMap(point => point.requests === null ? [] : [point.requests]);
    const peak = known.length ? Math.max(...known) : null;
    return { total, peak, avg: total === null ? null : total / points.length };
  }, [q.data]);

  if (q.isPending) return <PanelSkeleton className="h-72" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;

  return (
    <div className="space-y-3">
      {summary ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            Total <span className="num font-medium text-foreground">{formatInt(summary.total)}</span>
          </span>
          <span className="text-muted-foreground">
            Peak/bucket{" "}
            <span className="num font-medium text-foreground">{formatInt(summary.peak)}</span>
          </span>
          <span className="text-muted-foreground">
            Avg/bucket{" "}
            <span className="num font-medium text-foreground">{formatInt(summary.avg)}</span>
          </span>
        </div>
      ) : null}
      <PlatformRequestsChart data={data} tickFormatter={tickFormatterFor(params.range)} />
    </div>
  );
}

/** Authoritative platform-metrics band at the top of Overview. */
function AuthoritativeUsageBand() {
  const { params } = useDashboardParams();
  const q = usePlatformUsage(params);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <PanelSkeleton key={i} className="h-[78px]" />
        ))}
      </div>
    );
  }
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data) return <PanelEmpty />;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard
        label="Requests"
        value={formatInt(data.requests)}
        hint="all model requests"
      />
      <StatCard
        label="Total tokens"
        value={formatTokens(data.totalTokens)}
        hint={
          <>
            {formatTokens(data.inputTokens)} in · {formatTokens(data.outputTokens)} out
          </>
        }
      />
      <StatCard
        label="Est. cost"
        value={formatCost(data.estCost)}
        hint={`estimated · ${data.priceSource}`}
      />
      <StatCard
        label="Error rate"
        value={data.errorRate === null ? "—" : formatPct(data.errorRate)}
        hint={data.errorRate === null ? "n/a" : "platform-reported"}
        invertDelta
      />
    </div>
  );
}
