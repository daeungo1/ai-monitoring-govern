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

import type { TokensSeriesData } from "@shared/contracts";

import { formatTokens } from "@/features/_shared/format";
import { completeSum } from "@/features/_shared/aggregate";

const config: ChartConfig = {
  input: { label: "Uncached input", color: "hsl(var(--chart-1))" },
  output: { label: "Output", color: "hsl(var(--chart-2))" },
  cached: { label: "Cached", color: "hsl(var(--chart-3))" },
};

export function TokensAreaChart({
  data,
  tickFormatter,
  className,
}: {
  data: TokensSeriesData;
  tickFormatter: (value: unknown) => string;
  className?: string;
}) {
  const points = useMemo(() => data.points.map(point => ({ ...point,
    input: point.input === null || point.cached === null || point.cached > point.input ? null : point.input - point.cached,
  })), [data.points]);
  const totals = useMemo(() => {
    const input = completeSum(points.map(point => point.input));
    const output = completeSum(points.map(point => point.output));
    const cached = completeSum(points.map(point => point.cached));
    return {
      input: formatTokens(input),
      output: formatTokens(output),
      cached: formatTokens(cached),
    };
  }, [points]);

  return (
    <ChartContainer config={config} className={className ?? "h-72 w-full"}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="tk-input" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-input)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-input)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="tk-output" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-output)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-output)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="tk-cached" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-cached)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-cached)" stopOpacity={0.05} />
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
          dataKey="input"
          stackId="t"
          stroke="var(--color-input)"
          fill="url(#tk-input)"
        />
        <Area
          type="monotone"
          dataKey="output"
          stackId="t"
          stroke="var(--color-output)"
          fill="url(#tk-output)"
        />
        <Area
          type="monotone"
          dataKey="cached"
          stackId="t"
          stroke="var(--color-cached)"
          fill="url(#tk-cached)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
