import { Area, AreaChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface SparkPoint extends Record<string, unknown> {
  ts: string;
}

/**
 * Compact single-series sparkline. ~64px tall.
 */
export function Sparkline({
  data,
  dataKey,
  color = "hsl(var(--chart-1))",
  className,
  tooltipFormatter,
}: {
  data: readonly SparkPoint[];
  dataKey: string;
  color?: string;
  className?: string;
  tooltipFormatter?: (value: unknown) => string;
}) {
  const config: ChartConfig = {
    [dataKey]: { label: dataKey, color },
  };
  return (
    <ChartContainer config={config} className={className ?? "h-16 w-full"}>
      <AreaChart data={[...data]} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.5} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              indicator="line"
              formatter={(value) => (
                <span className="num font-medium">
                  {tooltipFormatter ? tooltipFormatter(value) : String(value)}
                </span>
              )}
            />
          }
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          fill={`url(#spark-${dataKey})`}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
