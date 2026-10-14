import assert from "node:assert/strict";
import test from "node:test";

function memoryStore() {
  let ledger = { day: "2026-10-14", accountedUsd: 0, limitUsd: 20, activeRun: null, lastFixtureAt: 0 };
  const claims = new Map();
  let tail = Promise.resolve();
  return {
    readLedger: async () => structuredClone(ledger),
    transaction: fn => {
      const result = tail.then(async () => {
        const working = structuredClone(ledger);
        const result = await fn(working);
        ledger = working;
        return result;
      });
      tail = result.catch(() => undefined);
      return result;
    },
    listClaims: async id => [...claims.values()].filter(c => c.runId === id).map(c => structuredClone(c)),
    countActive: async (id, now) => [...claims.values()].filter(c =>
      c.runId === id && !c.event && !c.cancelled && now - c.startedAt < 60000).length,
    claim: async (runId, index, startedAt) => {
      const key = `${runId}:${index}`;
      if (claims.has(key)) return false;
      claims.set(key, { runId, index, startedAt });
      return true;
    },
    complete: async (id, index, event) => {
      claims.set(`${id}:${index}`, { ...claims.get(`${id}:${index}`), event });
    },
    cancel: async (id, index) => {
      claims.set(`${id}:${index}`, { ...claims.get(`${id}:${index}`), cancelled: true });
    },
  };
}
const now = Date.parse("2026-10-14T12:00:00Z");
const models = [{ deployment: "a", model: "a", modelVersion: "1", deploymentSku: "GlobalStandard", capacity: 10 }];
const price = { model: "a", modelVersion: "1", deploymentSku: "GlobalStandard", currency: "USD",
  inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 12, status: "verified",
  effectiveFrom: "2026-10-14", effectiveTo: "2026-11-14", source: "https://example.test/prices" };
const config = { prompt: "Fictional service is healthy.", outputTokens: 64, totalCalls: 3,
  requestsPerSecond: 30, concurrency: 3, fixtures: false, allocations: [{ deployment: "a", percent: 100 }] };
async function service(store = memoryStore(), time = () => now) {
  const { WebService } = await import("../dist/web-service.js");
  return { store, app: new WebService(store, models, new Map([["a", price]]), time) };
}

test("simultaneous starts reserve independently and preserve both runs", async () => {
  const { app, store } = await service();
  const results = await Promise.allSettled([app.start(config), app.start(config)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
  const runs = results.map(r => r.value);
  assert.notEqual(runs[0].runId, runs[1].runId);
  assert.equal((await app.admit(runs[0].runId, 0, config.prompt)).run.runId, runs[0].runId);
  assert.equal((await app.admit(runs[1].runId, 0, config.prompt)).run.runId, runs[1].runId);
  await store.complete(runs[0].runId, 0, { estimatedCostUsd: 0.001, outcome: "success", statusCode: 200 });
  assert.equal((await app.stop(runs[0].runId)).status, "stopped");
  assert.equal((await app.status(runs[1].runId)).status, "running");
  const ledger = await store.readLedger();
  assert.equal(ledger.accountedUsd, 0.02788);
  assert.equal(ledger.activeRun.prompt, undefined);
  assert.equal(JSON.stringify(ledger).includes(config.prompt), false);
});

test("duplicate permits cannot issue a second paid model call", async () => {
  const { app } = await service();
  const run = await app.start(config);
  const claim = await app.admit(run.runId, 0, config.prompt);
  assert.equal(claim.model.deployment, "a");
  await assert.rejects(app.admit(run.runId, 0, config.prompt), e => e.status === 409);
  await assert.rejects(app.admit(run.runId, 1, "different prompt"), e => e.status === 400);
  await assert.rejects(app.admit(run.runId, 3, config.prompt), e => e.status === 400);
});

test("stop persists, refunds unused calls, preserves unknown costs and rejects later calls", async () => {
  const { app, store } = await service();
  const run = await app.start(config);
  await app.admit(run.runId, 0, config.prompt);
  const stopped = await app.stop(run.runId);
  assert.equal(stopped.status, "stopping");
  assert.equal(stopped.budget.accountedUsd, 0.00896);
  await assert.rejects(app.admit(run.runId, 1, config.prompt), e => e.status === 409);
  await store.complete(run.runId, 0, { estimatedCostUsd: 0.001, outcome: "success", statusCode: 200 });
  const completed = await app.status(run.runId);
  assert.equal(completed.status, "stopped");
  assert.equal(completed.budget.accountedUsd, 0.001);
  assert.equal((await app.status(run.runId)).budget.accountedUsd, 0.001);
});

test("legacy 20 USD cap does not prevent runs above the previous daily budget", async () => {
  const store = memoryStore();
  await store.transaction(async ledger => { ledger.accountedUsd = 25; });
  const { app } = await service(store);
  const run = await app.start(config);
  assert.equal(run.status, "running");
  assert.equal(run.budget.accountedUsd, 25.02688);
  assert.equal(run.budget.limitUsd, null);
  assert.equal((await app.config()).limits.dailyBudgetUsd, null);
});

test("expired runs reject new calls and stale in-flight costs are retained", async () => {
  let clock = now;
  const { app, store } = await service(memoryStore(), () => clock);
  const run = await app.start(config);
  await app.admit(run.runId, 0, config.prompt);
  clock += 180000;
  await assert.rejects(app.admit(run.runId, 1, config.prompt), e => e.status === 409);
  const status = await app.status(run.runId);
  assert.equal(status.status, "stopped");
  assert.equal(status.budget.accountedUsd, 0.00896);
  assert.equal((await store.readLedger()).activeRun.status, "stopped");
});

test("fixture runs can restart immediately after stopping without a cooldown", async () => {
  const { app, store } = await service();
  await store.transaction(async ledger => { ledger.lastFixtureAt = now - 1000; });
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await app.start({ ...config, fixtures: true });
    assert.equal(run.status, "running");
    assert.equal(run.fixtures, true);
    assert.equal((await app.stop(run.runId)).status, "stopped");
  }
  assert.equal((await app.start(config)).status, "running");
});

test("fixture runs have no shared active-run or daily budget restriction", async () => {
  const { app, store } = await service();
  await store.transaction(async ledger => { ledger.accountedUsd = 25; });
  const first = await app.start({ ...config, fixtures: true });
  const second = await app.start({ ...config, fixtures: true });
  assert.notEqual(first.runId, second.runId);
  assert.equal((await app.status(first.runId)).status, "running");
  assert.equal((await app.status(second.runId)).status, "running");
});

test("controller does not reject calls when configured concurrency is occupied", async () => {
  const { app } = await service();
  const run = await app.start({ ...config, concurrency: 1 });
  await app.admit(run.runId, 0, config.prompt);
  assert.equal((await app.admit(run.runId, 1, config.prompt)).run.runId, run.runId);
});

test("existing ledger runs remain readable after enabling independent runs", async () => {
  const { app, store } = await service();
  const first = await app.start(config);
  await store.transaction(async ledger => { delete ledger.runs; });
  const second = await app.start(config);
  assert.equal((await app.status(first.runId)).status, "running");
  assert.equal((await app.status(second.runId)).status, "running");
});
