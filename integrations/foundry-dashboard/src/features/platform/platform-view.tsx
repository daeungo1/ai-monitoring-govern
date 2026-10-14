/**
 * Platform Usage — the authoritative lens.
 *
 * Renders Azure Monitor platform metrics on the Foundry resource. This view
 * matches the Foundry portal Monitor tab exactly: it reflects ALL traffic to
 * the resource (every API call), not just the subset that has gen_ai
 * OpenTelemetry instrumentation. For per-agent / per-operation / tool detail
 * (which only exists for instrumented calls), use the other views.
 *
 * Data sources: `usePlatformUsage`, `usePlatformUsageSeries`,
 * `usePlatformByModel`. All carry `meta.usageSource === 'platform-metrics'`.
 *
 * Note: the platform endpoints honour the `model` filter only — `agent` and
 * `operation` filters are ignored (the platform dimension is per-model). The
 * server emits a warning when filters are dropped; we surface the badge so
 * the lens is unambiguous.
 */
import { useMemo } from "react";
import { Info } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  usePlatformByModel,
  usePlatformUsage,
  usePlatformUsageSeries,
} from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import type { PlatformByModelData } from "@shared/contracts";

import { PlatformRequestsChart } from "@/components/charts/platform-requests-chart";
import { PlatformTokensChart } from "@/components/charts/platform-tokens-chart";
import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import { ServerTable, useTableState } from "@/features/_shared/server-table";
import { StatCard } from "@/features/_shared/stat-card";
import { UsageSourceBadge } from "@/features/_shared/usage-source-badge";
import {
  formatCost,
  formatInt,
  formatPct,
  formatTokens,
} from "@/features/_shared/format";
import { tickFormatterFor } from "@/features/_shared/tick-formatter";

type PlatformModelRow = PlatformByModelData["rows"][number];

export function PlatformView() {
  return (
    <div className="flex flex-col gap-4">
      <PlatformHeaderNote />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Authoritative usage</CardTitle>
            <PlatformUsageSourceLine />
          </div>
          <p className="text-xs text-muted-foreground">
            Totals for the selected range, across all traffic to the Foundry resource.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <PlatformKpiGrid />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Tokens over time</CardTitle>
            <p className="text-xs text-muted-foreground">
              Input + output, stacked. Platform metrics.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <PlatformTokensPanel />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Requests over time</CardTitle>
            <p className="text-xs text-muted-foreground">
              All model requests to the Foundry resource.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <PlatformRequestsPanel />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>By model</CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-deployment native requests and tokens. Cost is not inferred from native counters.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <PlatformByModelTable />
        </CardContent>
      </Card>
    </div>
  );
}

function PlatformHeaderNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs">
      <Info className="mt-0.5 h-4 w-4 text-success" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">
          Authoritative platform metrics — all traffic to the Foundry resource.
        </p>
        <p className="mt-0.5 text-muted-foreground">
          These counters come from Azure Monitor on the configured OpenAI account.
          They are separate from instrumented API request records and may have different ingestion coverage.
          Clear model/operation filters for account totals. Rows group by deployment, not model.
        </p>
      </div>
    </div>
  );
}

function PlatformUsageSourceLine() {
  const { params } = useDashboardParams();
  const q = usePlatformUsage(params);
  const source = q.data?.meta?.usageSource;
  return <UsageSourceBadge source={source} hint="· matches Foundry Monitor" />;
}

function PlatformKpiGrid() {
  const { params } = useDashboardParams();
  const q = usePlatformUsage(params);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <PanelSkeleton key={i} className="h-[78px]" />
        ))}
      </div>
    );
  }
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data) return <PanelEmpty />;

  const cached = data.cachedTokens;
  const errorRate = data.errorRate;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
            {cached !== null && cached > 0 ? <> · {formatTokens(cached)} cached</> : null}
          </>
        }
      />
      <StatCard
        label="Input tokens"
        value={formatTokens(data.inputTokens)}
        hint="prompt"
      />
      <StatCard
        label="Output tokens"
        value={formatTokens(data.outputTokens)}
        hint="completion"
      />
      <StatCard
        label="Est. cost"
        value={formatCost(data.estCost)}
        hint={`estimated · ${data.priceSource}`}
      />
      {errorRate !== null ? (
        <StatCard
          label="Error rate"
          value={formatPct(errorRate)}
          invertDelta
          hint="platform-reported"
        />
      ) : null}
    </div>
  );
}

function PlatformTokensPanel() {
  const { params } = useDashboardParams();
  const q = usePlatformUsageSeries(params);
  if (q.isPending) return <PanelSkeleton className="h-72" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return <PlatformTokensChart data={data} tickFormatter={tickFormatterFor(params.range)} />;
}

function PlatformRequestsPanel() {
  const { params } = useDashboardParams();
  const q = usePlatformUsageSeries(params);
  if (q.isPending) return <PanelSkeleton className="h-60" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return <PlatformRequestsChart data={data} tickFormatter={tickFormatterFor(params.range)} />;
}

const platformModelColumns: ColumnDef<PlatformModelRow, unknown>[] = [
  {
    header: "Model",
    accessorKey: "model",
    cell: ({ row }) => (
      <span className="font-mono text-[11px]">
        {row.original.model || (
          <span className="italic text-muted-foreground">(unattributed)</span>
        )}
      </span>
    ),
    meta: { sortKey: "model" },
  },
  {
    header: "Requests",
    accessorKey: "requests",
    cell: ({ row }) => formatInt(row.original.requests),
    meta: { sortKey: "requests", numeric: true },
  },
  {
    header: "Input",
    accessorKey: "inputTokens",
    cell: ({ row }) => formatTokens(row.original.inputTokens),
    meta: { sortKey: "inputTokens", numeric: true },
  },
  {
    header: "Output",
    accessorKey: "outputTokens",
    cell: ({ row }) => formatTokens(row.original.outputTokens),
    meta: { sortKey: "outputTokens", numeric: true },
  },
  {
    header: "Total",
    accessorKey: "totalTokens",
    cell: ({ row }) => formatTokens(row.original.totalTokens),
    meta: { sortKey: "totalTokens", numeric: true },
  },
  {
    header: "Est. cost",
    accessorKey: "estCost",
    cell: ({ row }) => formatCost(row.original.estCost),
    meta: { sortKey: "estCost", numeric: true },
  },
];

function PlatformByModelTable() {
  const { params } = useDashboardParams();
  const [table, setTable] = useTableState({
    page: 1,
    pageSize: 25,
    sort: "requests",
    dir: "desc",
  });
  const q = usePlatformByModel(params, { table });
  const rows = useMemo(() => q.data?.data.rows ?? [], [q.data]);
  const total = q.data?.data.total ?? 0;

  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <PanelEmpty />;

  return (
    <ServerTable
      columns={platformModelColumns}
      rows={rows}
      totalRows={total}
      table={table}
      onTableChange={setTable}
      isFetching={q.isFetching}
      caption="Models (platform metrics)"
    />
  );
}
