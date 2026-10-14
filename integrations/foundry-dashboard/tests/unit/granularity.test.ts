import { describe, expect, it } from "vitest";
import { resolveGranularity } from "../../server/time.js";
import type { ConcreteGranularity, Granularity, TimeRange } from "../../shared/contracts/index.js";

const start = Date.UTC(2026, 0, 1, 0, 0, 0);

function rangeForDays(days: number): TimeRange {
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function rangeForHours(hours: number): TimeRange {
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + hours * 60 * 60 * 1000).toISOString(),
  };
}

describe("resolveGranularity", () => {
  it.each<{ label: string; range: TimeRange; expected: ConcreteGranularity }>([
    { label: "short windows", range: rangeForHours(1), expected: "5m" },
    { label: "one day windows", range: rangeForHours(24), expected: "15m" },
    { label: "multi-day windows", range: rangeForDays(2), expected: "1h" },
    { label: "weekly windows", range: rangeForDays(7), expected: "6h" },
    { label: "multi-month windows", range: rangeForDays(60), expected: "1d" },
    { label: "half-year windows", range: rangeForDays(180), expected: "7d" },
  ])("uses $expected for auto over $label", ({ range, expected }) => {
    expect(resolveGranularity(range, "auto")).toBe(expected);
  });

  it.each<ConcreteGranularity>(["5m", "15m", "1h", "6h", "1d", "7d"])("echoes explicit granularity %s", (granularity) => {
    expect(resolveGranularity(rangeForDays(180), granularity satisfies Granularity)).toBe(granularity);
  });
});
