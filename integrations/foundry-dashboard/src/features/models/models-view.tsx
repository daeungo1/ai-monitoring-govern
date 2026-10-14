import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ColumnDef } from "@tanstack/react-table";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { useModels } from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import type { ModelsData } from "@shared/contracts";

import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import { ServerTable, useTableState } from "@/features/_shared/server-table";
import {
  formatCost,
  formatInt,
  formatMs,
  formatPct,
  formatTokens,
} from "@/features/_shared/format";

type ModelRow = ModelsData["rows"][number];

export function ModelsView() {
  const { params } = useDashboardParams();
  const [table, setTable] = useTableState({
    page: 1,
    pageSize: 25,
    sort: "calls",
    dir: "desc",
  });
  const q = useModels(params, { table });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Model comparison</CardTitle>
          <p className="text-xs text-muted-foreground">
            p95 latency by model · top 10 by calls.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <ModelP95Chart />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Models</CardTitle>
          <p className="text-xs text-muted-foreground">
            Calls, tokens, estimated cost, latency percentiles, error rate. Click headers to sort.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          {q.isPending ? (
            <PanelSkeleton className="h-80" />
          ) : q.isError ? (
            <PanelError error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <PanelEmpty />
          ) : (
            <ServerTable
              columns={modelColumns}
              rows={q.data.data.rows}
              totalRows={q.data.data.total}
              table={table}
              onTableChange={setTable}
              isFetching={q.isFetching}
              caption="Models"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const modelColumns: ColumnDef<ModelRow, unknown>[] = [
  {
    header: "Model",
    accessorKey: "model",
    cell: ({ row }) => (
      <span className="font-mono text-[11px]">{row.original.model}</span>
    ),
    meta: { sortKey: "model" },
  },
  {
    header: "Calls",
    accessorKey: "calls",
    cell: ({ row }) => formatInt(row.original.calls),
    meta: { sortKey: "calls", numeric: true },
  },
  {
    header: "Input",
    accessorKey: "input",
    cell: ({ row }) => formatTokens(row.original.input),
    meta: { sortKey: "input", numeric: true },
  },
  {
    header: "Output",
    accessorKey: "output",
    cell: ({ row }) => formatTokens(row.original.output),
    meta: { sortKey: "output", numeric: true },
  },
  {
    header: "Cached",
    accessorKey: "cached",
    cell: ({ row }) => formatTokens(row.original.cached),
    meta: { sortKey: "cached", numeric: true },
  },
  {
    header: "Total",
    accessorKey: "total",
    cell: ({ row }) => formatTokens(row.original.total),
    meta: { sortKey: "total", numeric: true },
  },
  {
    header: "Est. cost",
    accessorKey: "estCost",
    cell: ({ row }) => formatCost(row.original.estCost),
    meta: { sortKey: "estCost", numeric: true },
  },
  {
    header: "p50",
    accessorKey: "p50Ms",
    cell: ({ row }) => formatMs(row.original.p50Ms),
    meta: { sortKey: "p50Ms", numeric: true },
  },
  {
    header: "p90",
    accessorKey: "p90Ms",
    cell: ({ row }) => formatMs(row.original.p90Ms),
    meta: { sortKey: "p90Ms", numeric: true },
  },
  {
    header: "p95",
    accessorKey: "p95Ms",
    cell: ({ row }) => formatMs(row.original.p95Ms),
    meta: { sortKey: "p95Ms", numeric: true },
  },
  {
    header: "p99",
    accessorKey: "p99Ms",
    cell: ({ row }) => formatMs(row.original.p99Ms),
    meta: { sortKey: "p99Ms", numeric: true },
  },
  {
    header: "Error rate",
    accessorKey: "errorRate",
    cell: ({ row }) => formatPct(row.original.errorRate),
    meta: { sortKey: "errorRate", numeric: true },
  },
  {
    header: "Avg dur",
    accessorKey: "avgDurationMs",
    cell: ({ row }) => formatMs(row.original.avgDurationMs),
    meta: { sortKey: "avgDurationMs", numeric: true },
  },
];

const p95Config: ChartConfig = {
  p95Ms: { label: "p95 latency", color: "hsl(var(--chart-3))" },
};

function ModelP95Chart() {
  const { params } = useDashboardParams();
  const q = useModels(params, { table: { sort: "calls", dir: "desc", pageSize: 10, page: 1 } });

  const rows = useMemo(() => q.data?.data.rows ?? [], [q.data]);
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (rows.length === 0) return <PanelEmpty />;
  const height = Math.max(200, rows.length * 28 + 60);
  return (
    <ChartContainer config={p95Config} className="w-full" style={{ height }}>
      <BarChart
        data={[...rows]}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatMs(v)}
        />
        <YAxis
          type="category"
          dataKey="model"
          tickLine={false}
          axisLine={false}
          width={200}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <span className="num font-medium">{formatMs(value)}</span>
              )}
            />
          }
        />
        <Bar dataKey="p95Ms" fill="var(--color-p95Ms)" radius={[2, 2, 2, 2]} />
      </BarChart>
    </ChartContainer>
  );
}
