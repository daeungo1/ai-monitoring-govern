import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { CostBreakdownData } from "@shared/contracts";
import { formatCost, formatPct } from "@/features/_shared/format";

const config: ChartConfig = {
  estCost: { label: "Estimated cost", color: "hsl(var(--chart-1))" },
};

export function CostBreakdownBarChart({
  data,
  className,
  yLabelFormatter,
  emptyLabel = "(unattributed)",
}: {
  data: CostBreakdownData;
  className?: string;
  yLabelFormatter?: (key: string) => string;
  emptyLabel?: string;
}) {
  const rows = useMemo(
    () =>
      data.rows
        .map((r) => ({
          ...r,
          label: r.key.length > 0 ? (yLabelFormatter?.(r.key) ?? r.key) : emptyLabel,
        }))
        .slice(0, 10),
    [data.rows, yLabelFormatter, emptyLabel],
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
          tickFormatter={(v) => formatCost(v)}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={140}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
                const p = item.payload as { share?: number; billedCost?: number | null };
                return (
                  <div className="grid gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">estimated</span>
                      <span className="num font-medium">{formatCost(value)}</span>
                    </div>
                    {p?.share !== undefined ? (
                      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                        <span>share</span>
                        <span className="num">{formatPct(p.share)}</span>
                      </div>
                    ) : null}
                    {p?.billedCost !== undefined && p.billedCost !== null ? (
                      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                        <span>billed</span>
                        <span className="num">{formatCost(p.billedCost)}</span>
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <Bar dataKey="estCost" fill="var(--color-estCost)" radius={[2, 2, 2, 2]} />
      </BarChart>
    </ChartContainer>
  );
}
