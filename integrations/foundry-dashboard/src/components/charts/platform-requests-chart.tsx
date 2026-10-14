import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import type { PlatformUsageSeriesData } from "@shared/contracts";

import { formatInt } from "@/features/_shared/format";
import { completeSum } from "@/features/_shared/aggregate";

const config: ChartConfig = {
  requests: { label: "Requests", color: "hsl(var(--chart-4))" },
};

/**
 * Platform-metrics request volume over time. Matches the Foundry portal
 * "Model requests" panel and represents all traffic to the resource.
 */
export function PlatformRequestsChart({
  data,
  tickFormatter,
  className,
}: {
  data: PlatformUsageSeriesData;
  tickFormatter: (value: unknown) => string;
  className?: string;
}) {
  const totals = useMemo(() => {
    const requests = completeSum(data.points.map(point => point.requests));
    return { requests: formatInt(requests) };
  }, [data.points]);

  return (
    <ChartContainer config={config} className={className ?? "h-60 w-full"}>
      <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="pr-requests" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-requests)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--color-requests)" stopOpacity={0.05} />
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
          width={48}
          tickFormatter={(v) => formatInt(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFormatter(v)}
              formatter={(value) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">Requests</span>
                  <span className="num font-medium">{formatInt(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent values={totals} />} />
        <Area
          type="monotone"
          dataKey="requests"
          stroke="var(--color-requests)"
          fill="url(#pr-requests)"
          strokeWidth={1.5}
          name="Requests"
        />
      </AreaChart>
    </ChartContainer>
  );
}
