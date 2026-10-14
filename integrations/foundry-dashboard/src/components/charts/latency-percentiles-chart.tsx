import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import type { LatencySeriesData } from "@shared/contracts";

import { formatMs } from "@/features/_shared/format";

const config: ChartConfig = {
  p50Ms: { label: "p50", color: "hsl(var(--chart-1))" },
  p90Ms: { label: "p90", color: "hsl(var(--chart-2))" },
  p95Ms: { label: "p95", color: "hsl(var(--chart-3))" },
  p99Ms: { label: "p99", color: "hsl(var(--chart-5))" },
};

const SERIES = ["p50Ms", "p90Ms", "p95Ms", "p99Ms"] as const;

export function LatencyPercentilesChart({
  data,
  tickFormatter,
  className,
}: {
  data: LatencySeriesData;
  tickFormatter: (value: unknown) => string;
  className?: string;
}) {
  const averages = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of SERIES) {
      let sum = 0;
      let n = 0;
      for (const p of data.points) {
        const v = p[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          sum += v;
          n += 1;
        }
      }
      out[key] = n > 0 ? formatMs(sum / n) : "—";
    }
    return out;
  }, [data.points]);

  return (
    <ChartContainer config={config} className={className ?? "h-72 w-full"}>
      <LineChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
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
          tickFormatter={(v) => formatMs(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFormatter(v)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatMs(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent values={averages} />} />
        {SERIES.map((k) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={`var(--color-${k})`}
            dot={false}
            strokeWidth={1.75}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
