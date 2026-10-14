import { useMemo } from "react";

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

import { useTokensByModel, useTokensSeries } from "@/lib/queries";
import { useDashboardParams } from "@/features/controls/dashboard-params-context";

import { TokensAreaChart } from "@/components/charts/tokens-area-chart";
import {
  PanelEmpty,
  PanelError,
  PanelSkeleton,
} from "@/features/_shared/panel-state";
import {
  formatCost,
  formatInt,
  formatPct,
  formatTokens,
} from "@/features/_shared/format";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { tickFormatterFor } from "@/features/_shared/tick-formatter";

export function TokenomicsView() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Tokens over time</CardTitle>
          <p className="text-xs text-muted-foreground">
            Stacked input / output / cached. Counts in tokens.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <TokensTrendPanel />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Cache-hit ratio</CardTitle>
            <p className="text-xs text-muted-foreground">
              cached / prompt tokens per bucket (cached is a subset of prompt)
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <CacheHitTrendPanel />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Tokens by model</CardTitle>
            <p className="text-xs text-muted-foreground">
              Total tokens per model (top 10).
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <TokensByModelChartPanel />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Top consumers</CardTitle>
          <p className="text-xs text-muted-foreground">
            Observed token totals. Rates are unavailable without exact version/SKU; separate current-snapshot repricing is in Requests.
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <TokensByModelTablePanel />
        </CardContent>
      </Card>
    </div>
  );
}

function TokensTrendPanel() {
  const { params } = useDashboardParams();
  const q = useTokensSeries(params);
  if (q.isPending) return <PanelSkeleton className="h-72" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return <TokensAreaChart data={data} tickFormatter={tickFormatterFor(params.range)} />;
}

const cacheConfig: ChartConfig = {
  cacheHitRatio: { label: "Cache-hit ratio", color: "hsl(var(--chart-2))" },
};

function CacheHitTrendPanel() {
  const { params } = useDashboardParams();
  const q = useTokensSeries(params);
  const tickFmt = tickFormatterFor(params.range);
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data?.data;
  if (!data || data.points.length === 0) return <PanelEmpty />;
  return (
    <ChartContainer config={cacheConfig} className="h-64 w-full">
      <LineChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
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
          domain={[0, 1]}
          tickFormatter={(v) => formatPct(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFmt(v)}
              formatter={(value) => (
                <span className="num font-medium">{formatPct(value)}</span>
              )}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="cacheHitRatio"
          stroke="var(--color-cacheHitRatio)"
          strokeWidth={1.75}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

const byModelConfig: ChartConfig = {
  input: { label: "Input", color: "hsl(var(--chart-1))" },
  output: { label: "Output", color: "hsl(var(--chart-2))" },
  cached: { label: "Cached", color: "hsl(var(--chart-3))" },
};

function TokensByModelChartPanel() {
  const { params } = useDashboardParams();
  const q = useTokensByModel(params, { table: { sort: "total", dir: "desc", topN: 10 } });
  if (q.isPending) return <PanelSkeleton className="h-64" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data?.data.rows ?? [];
  if (rows.length === 0) return <PanelEmpty />;
  const height = Math.max(220, rows.length * 30 + 60);
  return (
    <ChartContainer config={byModelConfig} className="w-full" style={{ height }}>
      <BarChart data={[...rows]} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatTokens(v)}
        />
        <YAxis type="category" dataKey="model" tickLine={false} axisLine={false} width={200} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatTokens(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="input" stackId="t" fill="var(--color-input)" />
        <Bar dataKey="output" stackId="t" fill="var(--color-output)" />
        <Bar dataKey="cached" stackId="t" fill="var(--color-cached)" />
      </BarChart>
    </ChartContainer>
  );
}

function TokensByModelTablePanel() {
  const { params } = useDashboardParams();
  const q = useTokensByModel(params, { table: { sort: "total", dir: "desc", topN: 25 } });

  const rows = useMemo(() => q.data?.data.rows ?? [], [q.data]);
  if (q.isPending) return <PanelSkeleton className="h-48" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (rows.length === 0) return <PanelEmpty />;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className={tableNumericClass}>Calls</TableHead>
            <TableHead className={tableNumericClass}>Input</TableHead>
            <TableHead className={tableNumericClass}>Output</TableHead>
            <TableHead className={tableNumericClass}>Cached</TableHead>
            <TableHead className={tableNumericClass}>Total tokens</TableHead>
            <TableHead className={tableNumericClass}>$ / 1k in</TableHead>
            <TableHead className={tableNumericClass}>$ / 1k out</TableHead>
            <TableHead className={tableNumericClass}>Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const estCost = r.input === null || r.output === null || r.costPer1kInput === null || r.costPer1kOutput === null ? null :
              (r.input * r.costPer1kInput) / 1000 +
              (r.output * r.costPer1kOutput) / 1000;
            return (
              <TableRow key={r.model}>
                <TableCell className="font-mono text-[11px]">{r.model}</TableCell>
                <TableCell className={tableNumericClass}>{formatInt(r.calls)}</TableCell>
                <TableCell className={tableNumericClass}>{formatTokens(r.input)}</TableCell>
                <TableCell className={tableNumericClass}>{formatTokens(r.output)}</TableCell>
                <TableCell className={tableNumericClass}>{formatTokens(r.cached)}</TableCell>
                <TableCell className={tableNumericClass}>{formatTokens(r.total)}</TableCell>
                <TableCell className={tableNumericClass}>{formatCost(r.costPer1kInput)}</TableCell>
                <TableCell className={tableNumericClass}>{formatCost(r.costPer1kOutput)}</TableCell>
                <TableCell className={tableNumericClass}>{formatCost(estCost)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
