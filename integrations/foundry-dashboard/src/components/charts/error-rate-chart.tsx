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
import type { ErrorsSeriesData } from "@shared/contracts";
import { formatInt, formatPct } from "@/features/_shared/format";

const config: ChartConfig = {
  errorRate: { label: "Error rate", color: "hsl(var(--chart-5))" },
};

export function ErrorRateChart({
  data,
  tickFormatter,
  className,
}: {
  data: ErrorsSeriesData;
  tickFormatter: (value: unknown) => string;
  className?: string;
}) {
  const overall = useMemo(() => {
    let errors = 0;
    let total = 0;
    for (const p of data.points) {
      errors += Number(p.errors) || 0;
      total += Number(p.total) || 0;
    }
    return { errorRate: total > 0 ? formatPct(errors / total) : "—" };
  }, [data.points]);

  return (
    <ChartContainer config={config} className={className ?? "h-64 w-full"}>
      <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="errRateFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-errorRate)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--color-errorRate)" stopOpacity={0.05} />
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
          tickFormatter={(v) => formatPct(v)}
          domain={[0, "auto"]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => tickFormatter(v)}
              formatter={(value, _name, item) => {
                const p = item.payload as { errors?: number; total?: number } | undefined;
                return (
                  <div className="grid w-full gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">error rate</span>
                      <span className="num font-medium">{formatPct(value)}</span>
                    </div>
                    {p ? (
                      <div className="text-[10px] text-muted-foreground">
                        {formatInt(p.errors)} of {formatInt(p.total)} calls
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent values={overall} />} />
        <Area
          type="monotone"
          dataKey="errorRate"
          stroke="var(--color-errorRate)"
          fill="url(#errRateFill)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ChartContainer>
  );
}
