import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CostSeriesData } from "@shared/contracts";

import { formatCost } from "@/features/_shared/format";
import { completeSum } from "@/features/_shared/aggregate";

const config: ChartConfig = {
  estCost: { label: "Estimated", color: "hsl(var(--chart-1))" },
  billedCost: { label: "Billed", color: "hsl(var(--chart-2))" },
};

export function CostSeriesChart({
  data,
  tickFormatter,
  showBilled,
  className,
}: {
  data: CostSeriesData;
  tickFormatter: (value: unknown) => string;
  showBilled: boolean;
  className?: string;
}) {
  const totals = useMemo(() => {
    const est = completeSum(data.points.map(point => point.estCost));
    const billed = completeSum(data.points.map(point => point.billedCost));
    const out: Record<string, string> = { estCost: formatCost(est) };
    if (showBilled) out.billedCost = formatCost(billed);
    return out;
  }, [data.points, showBilled]);

  return (
    <ChartContainer config={config} className={className ?? "h-72 w-full"}>
      <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="estCostFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-estCost)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--color-estCost)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={tickFormatter}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => formatCost(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFormatter(v)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatCost(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent values={totals} />} />
        <Area
          type="monotone"
          dataKey="estCost"
          stroke="var(--color-estCost)"
          fill="url(#estCostFill)"
          strokeWidth={1.5}
          name="Estimated"
        />
        {showBilled ? (
          <Line
            type="monotone"
            dataKey="billedCost"
            stroke="var(--color-billedCost)"
            strokeDasharray="4 3"
            dot={false}
            strokeWidth={1.5}
            name="Billed"
          />
        ) : null}
      </AreaChart>
    </ChartContainer>
  );
}
