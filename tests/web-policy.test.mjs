import assert from "node:assert/strict";
import test from "node:test";

const load = () => import("../dist/web-policy.js");
const models = [{ deployment: "a" }, { deployment: "b" }, { deployment: "c" }];
const config = () => ({
  prompt: "Summarize fictional operational notes.", outputTokens: 64,
  totalCalls: 60, requestsPerSecond: 30, concurrency: 64, fixtures: false,
  allocations: [{ deployment: "a", percent: 34 }, { deployment: "b", percent: 33 },
    { deployment: "c", percent: 33 }],
});

test("web configuration enforces limits, trusted deployments and exact allocation", async () => {
  const { validateWebConfig } = await load();
  assert.doesNotThrow(() => validateWebConfig(config(), models));
  for (const change of [
    { totalCalls: 501 }, { outputTokens: 513 }, { requestsPerSecond: 51 },
    { concurrency: 0 }, { concurrency: Number.MAX_SAFE_INTEGER + 1 }, { prompt: "" }, { prompt: "x".repeat(3501) },
    { prompt: "한".repeat(1200) }, { fixtures: "true" },
    { allocations: [{ deployment: "x", percent: 100 }] },
    { allocations: [{ deployment: "a", percent: 50 }, { deployment: "a", percent: 50 }] },
    { allocations: [{ deployment: "a", percent: 99 }] },
  ]) assert.throws(() => validateWebConfig({ ...config(), ...change }, models));
});

test("web concurrency has no application-defined upper bound", async () => {
  const { validateWebConfig, webLimits } = await load();
  assert.equal(webLimits.concurrency, null);
  assert.doesNotThrow(() => validateWebConfig({ ...config(), concurrency: 1000 }, models));
});

test("allocation preserves 60 calls, balances pacing and supports zero percentages", async () => {
  const { allocateCalls } = await load();
  const plan = allocateCalls(config());
  assert.equal(plan.length, 60);
  assert.deepEqual(models.map(m => plan.filter(p => p === m.deployment).length), [20, 20, 20]);
  assert.equal(new Set(plan.slice(0, 3)).size, 3);
  assert.deepEqual(allocateCalls({ ...config(), totalCalls: 7,
    allocations: [{ deployment: "a", percent: 0 }, { deployment: "b", percent: 100 }] }), Array(7).fill("b"));
  const one = allocateCalls({ ...config(), totalCalls: 1 });
  assert.deepEqual(one, ["a"]);
});

test("settlement releases only unused permits and confirmed actual usage", async () => {
  const { settledReservation } = await load();
  const reservations = [0.2, 0.3, 0.4, 0.5];
  const claims = [{ index: 0, event: { estimatedCostUsd: 0.01 } },
    { index: 1, event: { estimatedCostUsd: null } }, { index: 2 }];
  assert.equal(settledReservation(reservations, claims), 0.71);
  assert.equal(settledReservation(reservations, []), 0);
});
