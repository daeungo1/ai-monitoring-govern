import { type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatDelta } from "@/components/ui/stat-delta";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Secondary label shown directly under the value. */
  hint?: ReactNode;
  /** Percentage delta vs previous period (already in % units, e.g. 12.3). */
  delta?: number;
  /** Invert delta tone: up = bad (errors, latency). */
  invertDelta?: boolean;
  /** Loading state. */
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  delta,
  invertDelta,
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-1 p-3", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {!loading && delta !== undefined && Number.isFinite(delta) ? (
          <StatDelta value={delta} invert={invertDelta} />
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-24" />
      ) : (
        <div className="num text-xl font-semibold leading-tight tracking-tight">{value}</div>
      )}
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}
