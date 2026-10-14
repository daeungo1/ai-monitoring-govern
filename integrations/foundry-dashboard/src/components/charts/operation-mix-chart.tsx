import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import type { AgentsData } from "@shared/contracts";
import { formatInt } from "@/features/_shared/format";

const config: ChartConfig = {
  chat: { label: "chat", color: "hsl(var(--chart-1))" },
  invoke_agent: { label: "invoke_agent", color: "hsl(var(--chart-2))" },
  execute_tool: { label: "execute_tool", color: "hsl(var(--chart-3))" },
};

/**
 * Stacked operation mix by agent. Compact and dense.
 */
export function OperationMixByAgentChart({
  data,
  className,
}: {
  data: AgentsData;
  className?: string;
}) {
  const rows = useMemo(
    () =>
      data.rows.slice(0, 10).map((r) => ({
        label: r.agent || "(unattributed)",
        chat: r.operations.chat,
        invoke_agent: r.operations.invoke_agent,
        execute_tool: r.operations.execute_tool,
      })),
    [data.rows],
  );
  const height = Math.max(180, rows.length * 28 + 60);

  return (
    <ChartContainer config={config} className={className} style={{ height }}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatInt(v)}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={160}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="num font-medium">{formatInt(value)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {(["chat", "invoke_agent", "execute_tool"] as const).map((k) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="ops"
            fill={`var(--color-${k})`}
            radius={[0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
