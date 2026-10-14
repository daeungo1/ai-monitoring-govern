import { type ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  tableNumericClass,
} from "@/components/ui/table";

import {
  useErrorsSeries,
  useLatencySeries,
  useOperations,
  useRecentErrors,
} from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import type { ErrorType, RecentErrorsData } from "@shared/contracts";

import { ErrorRateChart } from "@/components/charts/error-rate-chart";
import { LatencyPercentilesChart } from "@/components/charts/latency-percentiles-chart";
import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import { ServerTable, useTableState } from "@/features/_shared/server-table";
import {
  formatAbsoluteTime,
  formatCost,
  formatInt,
  formatMs,
  formatPct,
} from "@/features/_shared/format";
import { tickFormatterFor } from "@/features/_shared/tick-formatter";
import { StreamingPanel } from "./streaming-panel";

type RecentErrorRow = RecentErrorsData["rows"][number];

export function OperationsView() {
  return (
    <div className="flex flex-col gap-4">
      <StreamingPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Error rate</CardTitle>
            <p className="text-xs text-muted-foreground">errors / total calls per bucket</p>
          </CardHeader>
          <CardContent className="pt-2">
            <ErrorRatePanel />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Latency percentiles</CardTitle>
            <p className="text-xs text-muted-foreground">p50 / p90 / p95 / p99 over time</p>
          </CardHeader>
          <CardContent className="pt-2">
            <LatencyPanel />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Operations</CardTitle>
          <p className="text-xs text-muted-foreground">
            Call volume by operation, with p95 and error rate. (Tokens only on `chat`.)
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <OperationsTable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Recent errors</CardTitle>
          <p className="text-xs text-muted-foreground">
            Latest failure categories and numeric status only. Raw error bodies are never queried.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <RecentErrorsPanel />
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorRatePanel() {
  const { params } = useDashboardParams();
  const q = useErrorsSeries(params);
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return <ErrorRateChart data={data} tickFormatter={tickFormatterFor(params.range)} />;
}

function LatencyPanel() {
  const { params } = useDashboardParams();
  const q = useLatencySeries(params);
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return <LatencyPercentilesChart data={data} tickFormatter={tickFormatterFor(params.range)} />;
}

function OperationsTable() {
  const { params } = useDashboardParams();
  const q = useOperations(params);
  if (q.isPending) return <PanelSkeleton className="h-40" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data?.data.rows ?? [];
  if (rows.length === 0) return <PanelEmpty />;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Operation</TableHead>
            <TableHead className={tableNumericClass}>Calls</TableHead>
            <TableHead className={tableNumericClass}>Input</TableHead>
            <TableHead className={tableNumericClass}>Output</TableHead>
            <TableHead className={tableNumericClass}>Cached</TableHead>
            <TableHead className={tableNumericClass}>Est. cost</TableHead>
            <TableHead className={tableNumericClass}>p95</TableHead>
            <TableHead className={tableNumericClass}>Error rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.operation}>
              <TableCell>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {r.operation}
                </Badge>
              </TableCell>
              <TableCell className={tableNumericClass}>{formatInt(r.calls)}</TableCell>
              <TableCell className={tableNumericClass}>{formatInt(r.input)}</TableCell>
              <TableCell className={tableNumericClass}>{formatInt(r.output)}</TableCell>
              <TableCell className={tableNumericClass}>{formatInt(r.cached)}</TableCell>
              <TableCell className={tableNumericClass}>{formatCost(r.estCost)}</TableCell>
              <TableCell className={tableNumericClass}>{formatMs(r.p95Ms)}</TableCell>
              <TableCell className={tableNumericClass}>{formatPct(r.errorRate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const ERROR_TYPE_VARIANT: Record<ErrorType, "destructive" | "warning" | "outline" | "secondary"> = {
  rate_limit: "warning",
  content_filter: "warning",
  timeout: "warning",
  auth: "destructive",
  server_5xx: "destructive",
  client_4xx: "outline",
  cancelled: "secondary",
  other: "outline",
};

const recentErrorColumns: ColumnDef<RecentErrorRow, unknown>[] = [
  {
    header: "Time",
    accessorKey: "ts",
    cell: ({ row }) => (
      <span className="num text-[11px] text-muted-foreground">
        {formatAbsoluteTime(row.original.ts)}
      </span>
    ),
    meta: { sortKey: "ts" },
  },
  {
    header: "Model",
    accessorKey: "model",
    cell: ({ row }) => (
      <span className="font-mono text-[11px]">{row.original.model || "—"}</span>
    ),
    meta: { sortKey: "model" },
  },
  {
    header: "Agent",
    accessorKey: "agent",
    cell: ({ row }) =>
      row.original.agent ? (
        row.original.agent
      ) : (
        <span className="italic text-muted-foreground">(unattributed)</span>
      ),
    meta: { sortKey: "agent" },
  },
  {
    header: "Op",
    accessorKey: "operation",
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-[10px]">
        {row.original.operation}
      </Badge>
    ),
    meta: { sortKey: "operation" },
  },
  {
    header: "Result",
    accessorKey: "resultCode",
    cell: ({ row }) => (
      <span className="num text-[11px]">{row.original.resultCode}</span>
    ),
    meta: { sortKey: "resultCode" },
  },
  {
    header: "Error type",
    accessorKey: "errorType",
    cell: ({ row }) => (
      <Badge
        variant={ERROR_TYPE_VARIANT[row.original.errorType]}
        className="text-[10px]"
      >
        {row.original.errorType}
      </Badge>
    ),
  },
  {
    header: "Duration",
    accessorKey: "durationMs",
    cell: ({ row }) => formatMs(row.original.durationMs),
    meta: { sortKey: "durationMs", numeric: true },
  },
];

function RecentErrorsPanel() {
  const { params } = useDashboardParams();
  const [table, setTable] = useTableState({
    page: 1,
    pageSize: 25,
    sort: "ts",
    dir: "desc",
  });
  // includeRaw stays false — gated by server flag and PII boundary.
  const q = useRecentErrors(params, { table, includeRaw: false });

  if (q.isPending) return <PanelSkeleton className="h-72" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data) return <PanelEmpty />;

  return (
    <ServerTable
      columns={recentErrorColumns}
      rows={data.rows}
      totalRows={data.total}
      table={table}
      onTableChange={setTable}
      isFetching={q.isFetching}
      caption="Recent errors"
    />
  );
}
