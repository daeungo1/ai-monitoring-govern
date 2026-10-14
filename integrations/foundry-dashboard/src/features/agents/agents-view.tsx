import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { type ColumnDef } from "@tanstack/react-table";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { useAgents, useAgentsActivity } from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import type { AgentsData } from "@shared/contracts";

import { OperationMixByAgentChart } from "@/components/charts/operation-mix-chart";
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
import { tickFormatterFor } from "@/features/_shared/tick-formatter";

const CHART_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

type AgentRow = AgentsData["rows"][number];

export function AgentsView() {
  const { params } = useDashboardParams();
  const [table, setTable] = useTableState({
    page: 1,
    pageSize: 25,
    sort: "calls",
    dir: "desc",
  });
  const q = useAgents(params, { table });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Operation mix by agent</CardTitle>
            <p className="text-xs text-muted-foreground">
              Stacked calls per operation, top 10 agents.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <OperationMixPanel />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Activity over time</CardTitle>
            <p className="text-xs text-muted-foreground">
              Calls per bucket — one line per top agent.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <AgentsActivityPanel />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Agents</CardTitle>
          <p className="text-xs text-muted-foreground">
            “(unattributed)” groups events with no agent dimension. Click headers to sort.
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
              columns={agentColumns}
              rows={q.data.data.rows}
              totalRows={q.data.data.total}
              table={table}
              onTableChange={setTable}
              isFetching={q.isFetching}
              caption="Agents"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const agentColumns: ColumnDef<AgentRow, unknown>[] = [
  {
    header: "Agent",
    accessorKey: "agent",
    cell: ({ row }) => (
      <span className={row.original.agent ? "" : "text-muted-foreground italic"}>
        {row.original.agent || "(unattributed)"}
      </span>
    ),
    meta: { sortKey: "agent" },
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
    header: "Total tokens",
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
    header: "p95",
    accessorKey: "p95Ms",
    cell: ({ row }) => formatMs(row.original.p95Ms),
    meta: { sortKey: "p95Ms", numeric: true },
  },
  {
    header: "Error rate",
    accessorKey: "errorRate",
    cell: ({ row }) => formatPct(row.original.errorRate),
    meta: { sortKey: "errorRate", numeric: true },
  },
  {
    header: "chat",
    accessorKey: "operations.chat",
    cell: ({ row }) => formatInt(row.original.operations.chat),
    meta: { numeric: true },
  },
  {
    header: "invoke",
    accessorKey: "operations.invoke_agent",
    cell: ({ row }) => formatInt(row.original.operations.invoke_agent),
    meta: { numeric: true },
  },
  {
    header: "tool",
    accessorKey: "operations.execute_tool",
    cell: ({ row }) => formatInt(row.original.operations.execute_tool),
    meta: { numeric: true },
  },
];

function OperationMixPanel() {
  const { params } = useDashboardParams();
  const q = useAgents(params, {
    table: { sort: "calls", dir: "desc", pageSize: 10, page: 1 },
  });
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.rows.length === 0) return <PanelEmpty />;
  return <OperationMixByAgentChart data={data} className="w-full" />;
}

function AgentsActivityPanel() {
  const { params } = useDashboardParams();
  const q = useAgentsActivity(params);
  const tickFmt = tickFormatterFor(params.range);

  // Discover series keys from the first point (anything other than `ts`).
  // Sanitize agent names so they're safe as CSS var names + dataKeys.
  const { points, series } = useMemo(() => {
    const raw = q.data?.data.points ?? [];
    const seen = new Set<string>();
    for (const p of raw) {
      for (const k of Object.keys(p)) if (k !== "ts") seen.add(k);
    }
    const list = Array.from(seen).slice(0, 5);
    const series = list.map((name) => ({
      name,
      key: `s${name.replace(/[^A-Za-z0-9_-]/g, "_") || "unattributed"}`,
    }));
    const remapped = raw.map((p) => {
      const out: Record<string, unknown> = { ts: p.ts };
      for (const s of series) {
        const v = p[s.name];
        out[s.key] = typeof v === "number" ? v : 0;
      }
      return out;
    });
    return { points: remapped, series };
  }, [q.data]);

  const config: ChartConfig = useMemo(() => {
    const out: ChartConfig = {};
    series.forEach((s, i) => {
      out[s.key] = {
        label: s.name || "(unattributed)",
        color: CHART_PALETTE[i % CHART_PALETTE.length],
      };
    });
    return out;
  }, [series]);

  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (points.length === 0 || series.length === 0) return <PanelEmpty />;

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <LineChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={tickFmt}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => formatInt(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFmt(v)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatInt(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Line
            key={s.key}
            name={s.name || "(unattributed)"}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            dot={false}
            strokeWidth={1.5}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
