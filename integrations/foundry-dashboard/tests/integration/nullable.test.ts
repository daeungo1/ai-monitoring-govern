// @vitest-environment node
import { expect, it } from "vitest";
import { completeSum } from "../../src/features/_shared/aggregate.js";
import { formatCost } from "../../src/features/_shared/format.js";
it("never turns an absent/partial series into zero in chart legends", () => {
  expect(completeSum([])).toBeNull();
  expect(completeSum([null])).toBeNull();
  expect(completeSum([100, null])).toBeNull();
  expect(completeSum([100, 0])).toBe(100);
  expect(completeSum([0])).toBe(0);
  expect(formatCost(null)).toBe("—");
  expect(formatCost(0.0000191)).toContain("0.0000191");
});
