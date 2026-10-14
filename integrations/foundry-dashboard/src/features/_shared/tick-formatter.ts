import type { TimeRangeParams, TimeRangePreset } from "@/types/dashboard";
import { formatTickDate, formatTickDateTime, formatTickTime } from "./format";

type TickFormatter = (value: unknown) => string;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Pick a reasonable X-axis tick formatter for the current preset. */
export function tickFormatterForPreset(
  preset: TimeRangePreset | undefined,
): TickFormatter {
  switch (preset) {
    case "1h":
    case "6h":
    case "24h":
      return formatTickTime;
    case "7d":
      return formatTickDateTime;
    case "30d":
      return formatTickDate;
    default:
      return formatTickDateTime;
  }
}

/** Pick a tick formatter from an absolute span (ms between from/to). */
function tickFormatterForSpanMs(spanMs: number): TickFormatter {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return formatTickDateTime;
  if (spanMs <= DAY_MS) return formatTickTime; // intraday → HH:mm:ss
  if (spanMs <= 3 * DAY_MS) return formatTickDateTime; // a few days → Mon d HH:mm
  return formatTickDate; // longer → Mon d
}

/**
 * Range-aware X-axis tick formatter. Honours an explicit preset when present,
 * otherwise derives the right granularity from a custom from/to span so custom
 * ranges format ticks sensibly (not the generic fallback).
 */
export function tickFormatterFor(range: TimeRangeParams | undefined): TickFormatter {
  if (range?.from && range?.to) {
    const span = Date.parse(range.to) - Date.parse(range.from);
    return tickFormatterForSpanMs(span);
  }
  return tickFormatterForPreset(range?.preset);
}
