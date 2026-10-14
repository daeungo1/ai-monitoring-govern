import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { DEFAULT_TIME_RANGE_PRESET } from "@/types/dashboard";
import { formatAbsoluteTime } from "@/features/_shared/format";

import { useDashboardParams } from "./dashboard-params-context";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Render a Date as a `datetime-local`-compatible string in local wall-clock. */
function toLocalInputValue(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toLocalInputValue(d);
}

/**
 * `datetime-local` values are local wall-clock with no zone. `new Date(value)`
 * interprets them in the local zone; `.toISOString()` then yields a valid
 * offset-aware instant for the API. Guard against empty/partial input, which
 * would otherwise throw on `.toISOString()`.
 */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

type Shortcut = { label: string; compute: () => { fromIso: string; toIso: string } };

const SHORTCUTS: Shortcut[] = [
  {
    label: "Today",
    compute: () => {
      const now = new Date();
      return { fromIso: startOfDay(now).toISOString(), toIso: now.toISOString() };
    },
  },
  {
    label: "Yesterday",
    compute: () => {
      const start = startOfDay(new Date());
      const prev = new Date(start);
      prev.setDate(prev.getDate() - 1);
      return { fromIso: prev.toISOString(), toIso: start.toISOString() };
    },
  },
  {
    label: "This month",
    compute: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { fromIso: first.toISOString(), toIso: now.toISOString() };
    },
  },
  {
    label: "Last 90 days",
    compute: () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 90);
      return { fromIso: from.toISOString(), toIso: now.toISOString() };
    },
  },
];

/**
 * Custom absolute time-range selector. Complements the quick presets so an
 * operator can pin an investigation to an exact window. Setting a custom range
 * clears any active preset; choosing a preset elsewhere clears the custom range.
 */
export function DateRangePicker({ active }: { active: boolean }) {
  const { params, setCustomRange, setRangePreset } = useDashboardParams();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) {
      setFrom(isoToLocalInput(params.range.from));
      setTo(isoToLocalInput(params.range.to));
    }
    setOpen(next);
  }

  const fromIso = localInputToIso(from);
  const toIso = localInputToIso(to);
  const valid = Boolean(fromIso && toIso && Date.parse(fromIso) < Date.parse(toIso));

  function apply() {
    if (!valid || !fromIso || !toIso) return;
    setCustomRange(fromIso, toIso);
    setOpen(false);
  }

  function applyShortcut(s: Shortcut) {
    const { fromIso: f, toIso: t } = s.compute();
    setCustomRange(f, t);
    setOpen(false);
  }

  function clear() {
    setRangePreset(DEFAULT_TIME_RANGE_PRESET);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={active}
          title="Custom date range"
          className={cn(
            "h-8 gap-1.5",
            active && "border-primary/50 bg-secondary text-foreground",
          )}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Custom</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Custom range</p>
          <p className="text-xs text-muted-foreground">
            Times are in your local zone.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SHORTCUTS.map((s) => (
            <Button
              key={s.label}
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => applyShortcut(s)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="range-from" className="text-xs">
              From
            </Label>
            <Input
              id="range-from"
              type="datetime-local"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-describedby="range-msg"
              aria-invalid={Boolean(from && to && !valid)}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="range-to" className="text-xs">
              To
            </Label>
            <Input
              id="range-to"
              type="datetime-local"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-describedby="range-msg"
              aria-invalid={Boolean(from && to && !valid)}
              className="h-8"
            />
          </div>
        </div>

        <div id="range-msg" aria-live="polite" className="min-h-[1rem]">
          {from && to && !valid ? (
            <p className="text-xs text-destructive">
              “From” must be before “To”.
            </p>
          ) : valid && fromIso && toIso ? (
            <p className="text-[11px] text-muted-foreground">
              {formatAbsoluteTime(fromIso)} → {formatAbsoluteTime(toIso)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-8" onClick={clear}>
            Reset to preset
          </Button>
          <Button size="sm" className="h-8" disabled={!valid} onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
