import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { RequestsData } from "@shared/contracts";
import { apiFetch } from "@/lib/api/client";
import { toQueryParams } from "@/types/dashboard";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerTable, useTableState } from "@/features/_shared/server-table";
import { formatAbsoluteTime, formatCost, formatInt, formatMs } from "@/features/_shared/format";
import { PanelError, PanelSkeleton } from "@/features/_shared/panel-state";
import { StreamingPanel } from "./streaming-panel";

type Row = RequestsData["rows"][number];
const columns: ColumnDef<Row>[] = [
  { accessorKey: "ts", header: "Time", cell: ({ row }) => formatAbsoluteTime(row.original.ts) },
  { accessorKey: "model", header: "Model" },
  { accessorKey: "deployment", header: "Deployment" },
  { accessorKey: "outcome", header: "Outcome" },
  { accessorKey: "statusCode", header: "Status", cell: ({ row }) => formatInt(row.original.statusCode) },
  { accessorKey: "input", header: "Prompt", cell: ({ row }) => formatInt(row.original.input) },
  { accessorKey: "output", header: "Completion", cell: ({ row }) => formatInt(row.original.output) },
  { accessorKey: "cached", header: "Cached", cell: ({ row }) => formatInt(row.original.cached) },
  { accessorKey: "estimatedCostUsd", header: "Recorded estimate", cell: ({ row }) => formatCost(row.original.estimatedCostUsd) },
  { accessorKey: "priceStatus", header: "Recorded price status" },
  { accessorKey: "currentRetailCostUsd", header: "Current retail snapshot", cell: ({ row }) =>
    <span title={row.original.currentRetailPriceBasis}>{formatCost(row.original.currentRetailCostUsd)}</span> },
  { accessorKey: "streaming", header: "Streaming", cell: ({ row }) => row.original.streaming === null ? "—" : String(row.original.streaming) },
  { accessorKey: "ttftMs", header: "TTFT", cell: ({ row }) => formatMs(row.original.ttftMs) },
  { accessorKey: "interChunkMeanMs", header: "Inter-chunk mean", cell: ({ row }) => formatMs(row.original.interChunkMeanMs) },
  { accessorKey: "streamCompleted", header: "Stream completed", cell: ({ row }) => row.original.streamCompleted === null ? "—" : String(row.original.streamCompleted) },
];

export function RequestsView() {
  const { params } = useDashboardParams();
  const [table, setTable] = useTableState({ page: 1, pageSize: 25, sort: "ts", dir: "desc" });
  const query = useQuery({ queryKey: ["requests", params, table],
    queryFn: ({ signal }) => apiFetch<RequestsData>("/requests", toQueryParams(params, { table }), { signal }) });
  return <div className="flex flex-col gap-4">
    <StreamingPanel />
    <Card>
      <CardHeader><CardTitle>Safe request ledger</CardTitle>
        <p className="text-xs text-muted-foreground">Recorded cost stays null when unconfigured. Separate current retail snapshot: 2026-10-14, GlobalStandard short context ≤4096 prompt tokens, USD; not an invoice. No prompts, completions, or raw error bodies are collected here.</p>
      </CardHeader>
      <CardContent>{query.isPending ? <PanelSkeleton className="h-40" /> : query.isError ? <PanelError error={query.error} onRetry={() => query.refetch()} /> :
        <ServerTable columns={columns} rows={query.data?.data.rows ?? []}
          totalRows={query.data?.data.total ?? 0} table={table} onTableChange={setTable}
          isFetching={query.isFetching} />}</CardContent>
    </Card>
  </div>;
}
