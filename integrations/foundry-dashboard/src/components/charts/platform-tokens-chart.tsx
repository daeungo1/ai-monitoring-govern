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

import { formatTokens } from "@/features/_shared/format";
import { completeSum } from "@/features/_shared/aggregate";

const config: ChartConfig = {
  inputTokens: { label: "Input", color: "hsl(var(--chart-1))" },
  outputTokens: { label: "Output", color: "hsl(var(--chart-2))" },
};

/**
 * Stacked input/output tokens over time, driven by authoritative platform
 * metrics (Azure Monitor). Matches the Foundry portal Monitor tab.
 */
export function PlatformTokensChart({
  data,
  tickFormatter,
  className,
}: {
  data: PlatformUsageSeriesData;
  tickFormatter: (value: unknown) => string;
  className?: string;
}) {
  const totals = useMemo(() => {
    const inputTokens = completeSum(data.points.map(point => point.inputTokens));
    const outputTokens = completeSum(data.points.map(point => point.outputTokens));
    return {
      inputTokens: formatTokens(inputTokens),
      outputTokens: formatTokens(outputTokens),
    };
  }, [data.points]);

  return (
    <ChartContainer config={config} className={className ?? "h-72 w-full"}>
      <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="pt-input" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-inputTokens)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-inputTokens)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="pt-output" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-outputTokens)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-outputTokens)" stopOpacity={0.05} />
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
          tickFormatter={(v) => formatTokens(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFormatter(v)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatTokens(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent values={totals} />} />
        <Area
          type="monotone"
          dataKey="inputTokens"
          stackId="p"
          stroke="var(--color-inputTokens)"
          fill="url(#pt-input)"
          name="Input"
        />
        <Area
          type="monotone"
          dataKey="outputTokens"
          stackId="p"
          stroke="var(--color-outputTokens)"
          fill="url(#pt-output)"
          name="Output"
        />
      </AreaChart>
    </ChartContainer>
  );
}
