import type { ConcreteGranularity, Granularity, TimeRange, TimeRangeQuery } from "../shared/contracts/index.js";

const presetMs: Record<NonNullable<TimeRangeQuery["preset"]>, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export const granularityMs: Record<ConcreteGranularity, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function resolveTimeRange(query: TimeRangeQuery): TimeRange {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - presetMs[query.preset ?? "24h"]);
  if (from >= to) throw new Error("from must be before to");
  return { from: from.toISOString(), to: to.toISOString() };
}

export function resolveGranularity(range: TimeRange, requested: Granularity): ConcreteGranularity {
  if (requested !== "auto") return requested;
  const ms = new Date(range.to).getTime() - new Date(range.from).getTime();
  const target = ms / 120;
  if (target <= granularityMs["5m"]) return "5m";
  if (target <= granularityMs["15m"]) return "15m";
  if (target <= granularityMs["1h"]) return "1h";
  if (target <= granularityMs["6h"]) return "6h";
  if (target <= granularityMs["1d"]) return "1d";
  return "7d";
}

export function floorToBucket(date: Date, granularity: ConcreteGranularity): Date {
  const size = granularityMs[granularity];
  return new Date(Math.floor(date.getTime() / size) * size);
}

export function enumerateBuckets(range: TimeRange, granularity: ConcreteGranularity): string[] {
  const start = floorToBucket(new Date(range.from), granularity).getTime();
  const end = new Date(range.to).getTime();
  const step = granularityMs[granularity];
  const buckets: string[] = [];
  for (let ts = start; ts <= end; ts += step) buckets.push(new Date(ts).toISOString());
  return buckets;
}

export function kqlTimespan(granularity: ConcreteGranularity): string {
  return granularity;
}
