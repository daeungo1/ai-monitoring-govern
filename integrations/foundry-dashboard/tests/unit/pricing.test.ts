import { describe, expect, it } from "vitest";
import { CostSeriesDataSchema } from "../../shared/contracts/index.js";
import { MockTelemetryAdapter } from "../../server/adapters/mock.js";
import type { QueryContext } from "../../server/adapters/types.js";
import { costPer1kInput, costPer1kOutput, estimateCost, findPrice, PRICE_SOURCE } from "../../server/pricing.js";

const miniModel = "gpt-5.4-mini-2026-03-17";

describe("pricing estimates", () => {
  it("calculates token cost from input, cached input, and output price table rows", () => {
    expect(estimateCost(miniModel, 1_000_000, 2_000_000, 500_000)).toBeCloseTo(5.13, 8);
  });

  it("applies the cached-token discount when cached pricing is configured", () => {
    const uncachedCost = estimateCost(miniModel, 1_000_000, 0, 0);
    const cachedCost = estimateCost(miniModel, 1_000_000, 0, 1_000_000);

    expect(uncachedCost).toBeCloseTo(0.6, 8);
    expect(cachedCost).toBeCloseTo(0.06, 8);
    expect(cachedCost).toBeLessThan(uncachedCost);
  });

  it("exposes per-1k helper rates from the same price table", () => {
    expect(costPer1kInput(miniModel)).toBeCloseTo(0.0006, 12);
    expect(costPer1kOutput(miniModel)).toBeCloseTo(0.0024, 12);
    expect(findPrice(`${miniModel}-extra-suffix`)).toEqual(findPrice(miniModel));
  });

  it("prices gpt-5.4 family variants without mini/nano prefix collisions", () => {
    const base = findPrice("gpt-5.4");
    const datedBase = findPrice("gpt-5.4-2026-03-17");
    const mini = findPrice("gpt-5.4-mini");
    const datedMini = findPrice("gpt-5.4-mini-2026-03-17");
    const nano = findPrice("gpt-5.4-nano-2026-03-17");

    expect(base?.inputPer1M).toBeGreaterThan(0);
    expect(datedBase?.outputPer1M).toBeGreaterThan(0);
    expect(estimateCost("gpt-5.4-2026-03-17", 1_000_000, 1_000_000, 0)).toBeGreaterThan(0);
    expect(datedMini?.inputPer1M).toBe(mini?.inputPer1M);
    expect(datedMini?.inputPer1M).not.toBe(base?.inputPer1M);
    expect(nano?.inputPer1M).not.toBe(mini?.inputPer1M);
    expect(estimateCost("gpt-5.4-mini-2026-03-17", 1_000_000, 1_000_000, 0)).not.toBe(
      estimateCost("gpt-5.4-nano-2026-03-17", 1_000_000, 1_000_000, 0),
    );
  });

  it("returns zero for unknown models and keeps the configured price source present", () => {
    expect(estimateCost("unknown-model", 1_000_000, 1_000_000, 0)).toBe(0);
    expect(PRICE_SOURCE).toContain("estimated");
  });

  it("marks mock cost-series summaries as USD with a price source", async () => {
    const adapter = new MockTelemetryAdapter();
    const ctx: QueryContext = {
      range: { from: "2026-04-08T00:00:00.000Z", to: "2026-04-08T12:00:00.000Z" },
      granularity: "1h",
      filters: {},
      table: { page: 1, pageSize: 25, dir: "desc", topN: 20 },
      includeRaw: false,
    };

    const result = await adapter.costSeries(ctx);
    const parsed = CostSeriesDataSchema.parse(result.data);

    expect(parsed.summary.currency).toBe("USD");
    expect(parsed.summary.priceSource).toBe(PRICE_SOURCE);
    expect(parsed.summary.priceSource.length).toBeGreaterThan(0);
  });
});
