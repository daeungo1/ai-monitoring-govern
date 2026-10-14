import { AlertTriangle } from "lucide-react";

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

import { useCostByAgent, useCostByModel, useCostSeries, usePlatformUsage } from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";

import { CostSeriesChart } from "@/components/charts/cost-series-chart";
import { CostBreakdownBarChart } from "@/components/charts/cost-breakdown-bar-chart";
import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import { StatCard } from "@/features/_shared/stat-card";
import { UsageSourceBadge } from "@/features/_shared/usage-source-badge";
import { formatCost, formatPct, formatInt } from "@/features/_shared/format";
import { tickFormatterFor } from "@/features/_shared/tick-formatter";

export function CostView() {
  return (
    <div className="flex flex-col gap-4">
      <AuthoritativeCostHeadline />

      <CostHeaderRow />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Cost over time</CardTitle>
            <CostLegend />
          </div>
          <p className="text-xs text-muted-foreground">
            Original per-request ledger estimates only. Missing estimates stay unavailable.
            Separate current-retail-snapshot repricing is shown in Requests & Streaming; neither is an invoice.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <CostSeriesPanel />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Cost by model</CardTitle>
            <p className="text-xs text-muted-foreground">Estimated, top 10. Share of total.</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CostByModelPanel />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Agents not applicable</CardTitle>
            <p className="text-xs text-muted-foreground">API-only workload, no agent attribution.</p>
          </CardHeader>
          <CardContent className="pt-2">
            <CostByAgentPanel />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Cost detail</CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-model breakdown with estimated and billed (when available).
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <CostDetailTable />
        </CardContent>
      </Card>
    </div>
  );
}

function CostLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--chart-1))" }} />
        Estimated <span className="opacity-70">(token × price)</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="h-0.5 w-3 rounded"
          style={{ background: "hsl(var(--chart-2))" }}
        />
        Billed <span className="opacity-70">(Cost Mgmt)</span>
      </span>
    </div>
  );
}

function CostHeaderRow() {
  const { params } = useDashboardParams();
  const q = useCostSeries(params);

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
  if (!data) return null;
  const meta = q.data?.meta;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Estimated-from-traces & billed (Cost Management)
        </h3>
        <UsageSourceBadge
          source={meta?.usageSource ?? "traces"}
          hint="· subset / authoritative billed where shown"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Est. cost (range, traces)"
          value={formatCost(data.summary.estTotal)}
          hint={`source: ${data.summary.priceSource}`}
        />
        <StatCard
          label="Billed (MTD)"
          value={
            data.summary.billedMtd === null ? (
              <span className="text-base font-medium text-muted-foreground">unavailable</span>
            ) : (
              formatCost(data.summary.billedMtd)
            )
          }
          hint={
            data.summary.billedMtd === null
              ? "Cost Mgmt RBAC"
              : "Azure Cost Management"
          }
        />
        <StatCard
          label="Projection (MTD)"
          value={
            data.summary.projectionMtd === null ? (
              <span className="text-base font-medium text-muted-foreground">—</span>
            ) : (
              formatCost(data.summary.projectionMtd)
            )
          }
          hint="trend-projected"
        />
        <StatCard
          label="Currency"
          value={<span className="text-base">{data.summary.currency}</span>}
          hint={`price source · ${data.summary.priceSource}`}
        />
      </div>
      {meta && !meta.costAvailable ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">Billed cost unavailable</p>
            <p className="mt-0.5 text-muted-foreground">
              This integration does not query invoices or Cost Management. Only recorded
              per-request estimates are shown here; unconfigured/missing estimates remain null.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            estimated only
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Authoritative cost headline — platform-metrics estimated cost for the
 * selected range. Closest pre-billing approximation to the portal Monitor
 * tab. Shown above the trace/Cost-Mgmt detail so operators see the
 * authoritative number first.
 */
function AuthoritativeCostHeadline() {
  const { params } = useDashboardParams();
  const q = usePlatformUsage(params);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Native usage (not billing)</CardTitle>
          <UsageSourceBadge
            source={q.data?.meta?.usageSource}
            hint="· OpenAI account metrics · cost not inferred"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Native account counters do not establish a billable model version or cache usage.
          Native cost stays unavailable. Recorded estimates and separately labeled retail snapshots are not invoices.
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        {q.isPending ? (
          <PanelSkeleton className="h-[78px]" />
        ) : q.isError ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data ? (
          <PanelEmpty />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Est. cost (range)"
              value={formatCost(q.data.data.estCost)}
              hint={`estimated · ${q.data.data.priceSource}`}
            />
            <StatCard
              label="Requests (range)"
              value={formatInt(q.data.data.requests)}
              hint="all model requests"
            />
            <StatCard
              label="Total tokens (range)"
              value={formatInt(q.data.data.totalTokens)}
              hint="platform metrics · all traffic"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostSeriesPanel() {
  const { params } = useDashboardParams();
  const q = useCostSeries(params);
  if (q.isPending) return <PanelSkeleton className="h-72" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  const showBilled = data.summary.costAvailable;
  return (
    <CostSeriesChart
      data={data}
      tickFormatter={tickFormatterFor(params.range)}
      showBilled={showBilled}
    />
  );
}

function CostByModelPanel() {
  const { params } = useDashboardParams();
  const q = useCostByModel(params, { table: { topN: 10 } });
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.rows.length === 0) return <PanelEmpty />;
  return <CostBreakdownBarChart data={data} className="w-full" />;
}

function CostByAgentPanel() {
  const { params } = useDashboardParams();
  const q = useCostByAgent(params, { table: { topN: 10 } });
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.rows.length === 0) return <PanelEmpty />;
  return <CostBreakdownBarChart data={data} className="w-full" />;
}

function CostDetailTable() {
  const { params } = useDashboardParams();
  const q = useCostByModel(params, { table: { topN: 25 } });
  if (q.isPending) return <PanelSkeleton className="h-48" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data?.data.rows ?? [];
  if (rows.length === 0) return <PanelEmpty />;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className={tableNumericClass}>Est. cost</TableHead>
            <TableHead className={tableNumericClass}>Billed</TableHead>
            <TableHead className={tableNumericClass}>Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key || "(unattributed)"}>
              <TableCell className="font-mono text-[11px]">
                {r.key || <span className="italic text-muted-foreground">(unattributed)</span>}
              </TableCell>
              <TableCell className={tableNumericClass}>{formatCost(r.estCost)}</TableCell>
              <TableCell className={tableNumericClass}>
                {r.billedCost === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatCost(r.billedCost)
                )}
              </TableCell>
              <TableCell className={tableNumericClass}>{formatPct(r.share)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
