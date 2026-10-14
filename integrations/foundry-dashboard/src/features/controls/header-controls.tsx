import { useState } from "react";
import { ChevronRight, KeyRound, RefreshCw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  TIME_RANGE_PRESETS,
  type TimeRangePreset,
} from "@/types/dashboard";
import { useHealth, useMeta } from "@/lib/queries";
import { ApiError } from "@/lib/api/client";
import type { Granularity, Operation } from "@shared/contracts";

import { useDashboardParams } from "./dashboard-params-context";
import { MultiSelectFilter } from "./multi-select";
import { DateRangePicker } from "./date-range-picker";
import { ThemeToggle } from "@/components/ui/theme";
import { formatRelativeTime } from "@/features/_shared/format";

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
];

const OPERATION_OPTIONS: { value: Operation; label: string }[] = [
  { value: "chat", label: "chat" },
];

export function HeaderControls() {
  const {
    params,
    setRangePreset,
    setGranularity,
    setModelFilter,
    setOperationFilter,
    refreshAll,
  } = useDashboardParams();

  const meta = useMeta();
  const modelOptions =
    meta.data?.data.models.map((m) => ({ value: m, label: m })) ?? [];

  const isCustomRange = Boolean(params.range.from && params.range.to);
  const activePreset: TimeRangePreset | null = isCustomRange
    ? null
    : params.range.preset ?? "24h";

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <RangePresetGroup value={activePreset} onChange={setRangePreset} />
      <DateRangePicker active={isCustomRange} />
      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <div className="hidden items-center gap-1 md:flex">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Bucket</span>
        <Select
          value={params.granularity}
          onValueChange={(v) => setGranularity(v as Granularity)}
        >
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRANULARITIES.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MultiSelectFilter
        label="Model"
        value={params.filters.model ?? []}
        options={modelOptions}
        onChange={setModelFilter}
        isLoading={meta.isPending}
        emptyMessage="No models seen yet"
      />
      <MultiSelectFilter<Operation>
        label="Operation"
        value={params.filters.operation ?? []}
        options={OPERATION_OPTIONS}
        onChange={setOperationFilter}
      />

      <ActiveFilterChips />

      <div className="ml-auto flex items-center gap-2">
        <SourceBadge />
        <ThemeToggle />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={refreshAll}
          title="Refresh all data"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RangePresetGroup({
  value,
  onChange,
}: {
  value: TimeRangePreset | null;
  onChange: (v: TimeRangePreset) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex h-8 items-center rounded-md border border-border bg-background p-0.5"
    >
      {TIME_RANGE_PRESETS.map((p) => {
        const active = p.value === value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            aria-pressed={active}
            className={cn(
              "h-7 rounded px-2 text-xs font-medium transition-colors",
              active
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.value}
          </button>
        );
      })}
    </div>
  );
}

function ActiveFilterChips() {
  const {
    params: { filters },
    setModelFilter,
    setAgentFilter,
    setOperationFilter,
  } = useDashboardParams();

  const chips: { kind: string; value: string; onRemove: () => void }[] = [];
  for (const m of filters.model ?? []) {
    chips.push({
      kind: "model",
      value: m,
      onRemove: () => setModelFilter((filters.model ?? []).filter((x) => x !== m)),
    });
  }
  for (const a of filters.agent ?? []) {
    chips.push({
      kind: "agent",
      value: a,
      onRemove: () => setAgentFilter((filters.agent ?? []).filter((x) => x !== a)),
    });
  }
  for (const o of filters.operation ?? []) {
    chips.push({
      kind: "op",
      value: o,
      onRemove: () => setOperationFilter((filters.operation ?? []).filter((x) => x !== o)),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="hidden flex-wrap items-center gap-1 lg:flex">
      {chips.slice(0, 4).map((c) => (
        <Badge
          key={`${c.kind}:${c.value}`}
          variant="outline"
          className="h-6 gap-1 pr-1 text-[10px] font-normal"
        >
          <span className="text-muted-foreground">{c.kind}:</span>
          <span className="max-w-[120px] truncate">{c.value}</span>
          <button
            type="button"
            onClick={c.onRemove}
            className="ml-0.5 rounded hover:bg-muted"
            aria-label={`Remove ${c.kind} ${c.value}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {chips.length > 4 ? (
        <span className="text-[10px] text-muted-foreground">+{chips.length - 4} more</span>
      ) : null}
    </div>
  );
}

function SourceBadge() {
  const h = useHealth();
  const data = h.data?.data;
  if (h.isPending) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        Connecting…
      </Badge>
    );
  }
  if (h.isError) {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground/80" />
        Server unreachable
      </Badge>
    );
  }
  const isLive = data?.source === "live";
  const az = data?.azStatus ?? "unknown";
  const variant = isLive ? "success" : "warning";
  const label = isLive ? "Live" : "Fixture · offline";
  const dot = isLive ? "bg-success-foreground/90" : "bg-warning-foreground/90";

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant} className="gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {label}
      </Badge>
      <span
        className="hidden text-[11px] text-muted-foreground md:inline"
        title={data?.dataAsOf ?? undefined}
      >
        as of {formatRelativeTime(data?.dataAsOf)}
      </span>
      {az !== "logged_in" && isLive ? (
        <span className="hidden items-center gap-1 text-[11px] text-warning md:inline-flex">
          <KeyRound className="h-3 w-3" />
          az {az}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Banner shown above the main grid: surfaces auth errors and meta warnings.
 */
export function GlobalAlerts() {
  const h = useHealth();
  const m = useMeta();
  const authErr =
    (h.error instanceof ApiError && h.error.code === "auth") ||
    (m.error instanceof ApiError && m.error.code === "auth");
  const azLoggedOut = h.data?.data.source === "live" && h.data?.data.azStatus === "logged_out";

  const warnings = m.data?.meta.warnings ?? [];
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-2 px-4 pt-3">
      {authErr || azLoggedOut ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <KeyRound className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-warning-foreground/90 dark:text-warning">
              Azure sign-in required
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">az login</code> in a
              terminal, then click refresh.
              <ChevronRight className="ml-0.5 inline h-3 w-3" />
            </p>
          </div>
        </div>
      ) : null}
      {warnings
        .filter((w) => !dismissed.has(w))
        .map((w) => (
          <div
            key={w}
            className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
          >
            <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            <div className="flex-1 text-muted-foreground">{w}</div>
            <button
              type="button"
              onClick={() => setDismissed((d) => new Set(d).add(w))}
              className="text-muted-foreground/70 hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
    </div>
  );
}
