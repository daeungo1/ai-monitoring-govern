import { useQuery } from "@tanstack/react-query";
import type { StreamingData } from "@shared/contracts";
import { apiFetch } from "@/lib/api/client";
import { toQueryParams } from "@/types/dashboard";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelError, PanelSkeleton } from "@/features/_shared/panel-state";
import { StatCard } from "@/features/_shared/stat-card";
import { formatInt, formatMs } from "@/features/_shared/format";

export function StreamingPanel() {
  const { params } = useDashboardParams();
  const query = useQuery({ queryKey: ["streaming", params],
    queryFn: ({ signal }) => apiFetch<StreamingData>("/streaming", toQueryParams(params), { signal }) });
  const data = query.data?.data;
  return <Card>
    <CardHeader><CardTitle>API streaming</CardTitle>
      <p className="text-xs text-muted-foreground">Observed TTFT and inter-chunk timings only; missing samples are not zero latency.</p>
    </CardHeader>
    <CardContent>
      {query.isPending ? <PanelSkeleton className="h-24" /> : query.isError ? <PanelError error={query.error} /> : data ? (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Streaming calls" value={formatInt(data.calls)} />
          <StatCard label="Completed / incomplete" value={`${data.completed} / ${data.incomplete}`} hint={`${data.completionUnknown} unknown completion`} />
          <StatCard label="TTFT p50" value={formatMs(data.ttftP50Ms)} hint={`${data.ttftKnown} known samples`} />
          <StatCard label="TTFT p95" value={formatMs(data.ttftP95Ms)} />
          <StatCard label="Inter-chunk mean p50" value={formatMs(data.interChunkMeanP50Ms)} hint={`${data.interChunkKnown} known samples`} />
          <StatCard label="Workload" value="API only" hint="Agents not applicable" />
        </div>
      ) : null}
    </CardContent>
  </Card>;
}
