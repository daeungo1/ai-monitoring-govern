import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLoadConfig, makePrompt, reservationUsd, selectWave, selectBurst, budgetAllows, summarizeLoad } from "../dist/load-policy.js";
import { readFile } from "node:fs/promises";
const config = JSON.parse(await readFile("config/load-test.json", "utf8"));
test("load policy rejects unsafe concurrency, rate, budget and token bounds", () => {
  validateLoadConfig(config);
  for (const change of [{ concurrency: 300 }, { cycleDelaySeconds: 0 }, { dailyBudgetUsd: -1 },
    { requestTimeoutMs: 1 }, { profiles: [{ ...config.profiles[0], outputTokens: 9000 }] },
    { profiles: [{ ...config.profiles[0], contextRepeats: 2000 }] }]) {
    assert.throws(() => validateLoadConfig({ ...config, ...change }), /load|profile/i);
  }
});
test("high-rate bursts are bounded independently of ordinary live waves", () => {
  validateLoadConfig({ ...config, burst: { requestsPerSecond: 30, durationSeconds: 2,
    intervalSeconds: 300, maxConcurrency: 64, outputTokens: 64 } });
  for (const burst of [
    { requestsPerSecond: 100 }, { durationSeconds: 60 }, { intervalSeconds: 0 },
    { maxConcurrency: 1000 }, { outputTokens: 8192 }
  ]) {
    assert.throws(() => validateLoadConfig({ ...config, burst: {
      requestsPerSecond: 30, durationSeconds: 2, intervalSeconds: 300,
      maxConcurrency: 64, outputTokens: 64, ...burst
    } }), /burst/i);
  }
});
test("30 RPS for two seconds schedules exactly 60 evenly distributed short requests", () => {
  const items = selectBurst(config.burst, ["a", "b", "c"]);
  assert.equal(items.length, 60);
  for (const model of ["a", "b", "c"]) assert.equal(items.filter(item => item.model === model).length, 20);
  assert.ok(items.every(item => item.profile.outputTokens === 64 && item.profile.id === "burst-30rps"));
  assert.throws(() => selectBurst(config.burst, []), /model/i);
});
test("safe inputs vary in size but stay inside conservative short-context bounds", () => {
  const prompts = config.profiles.map(makePrompt);
  assert.ok(prompts[0].length < prompts[1].length);
  assert.ok(prompts[1].length < prompts[2].length);
  assert.ok(prompts.every(p => p.length < 3500));
});
test("waves rotate profiles and vary exact calls across every requested model", () => {
  const models = [{ deployment: "a" }, { deployment: "b" }, { deployment: "c" }];
  assert.equal(selectWave(config, models, 0).length, 3);
  assert.equal(selectWave(config, models, 1)[0].profile.id, "medium-128");
  assert.equal(selectWave(config, models, 2).length, 6);
  assert.equal(selectWave(config, models, config.profiles.length)[0].profile.id, "short-64");
});
test("live safety probes use safe vocabulary and harmless override text, not harmful instructions", () => {
  const safety = makePrompt({ ...config.profiles[0], promptKind: "safety-vocabulary" });
  const override = makePrompt({ ...config.profiles[0], promptKind: "instruction-override" });
  assert.match(safety, /violence, hate, self-harm/);
  assert.match(override, /Ignore previous instructions/);
  assert.match(override, /HELLO/);
  assert.throws(() => validateLoadConfig({ ...config,
    profiles: [{ ...config.profiles[0], promptKind: "arbitrary" }] }), /profile/i);
});
test("daily budget reserves worst-case billable request before issuing any call", () => {
  const amount = reservationUsd({ inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 12 }, 256);
  assert.equal(amount, 0.011264);
  assert.equal(budgetAllows(4.995, amount, 5), false);
  assert.equal(budgetAllows(0, amount, 5), true);
});
test("daily summary preserves unknown usage/cost and separates reservation from estimates", () => {
  const events = [
    { profile: "a", model: "m", outcome: "success", usageKnown: true, promptTokens: 10, completionTokens: 20,
      estimatedCostUsd: 0.01, latencyMs: 100, stream: { ttftMs: 30, completed: true }, reservedUsd: 0.02 },
    { profile: "b", model: "m", outcome: "network_error", usageKnown: false, promptTokens: null, completionTokens: null,
      estimatedCostUsd: null, latencyMs: 200, stream: { ttftMs: null, completed: false }, reservedUsd: 0.02 }
  ];
  const s = summarizeLoad(events);
  assert.equal(s.attempts, 2);
  assert.equal(s.knownUsage, 1);
  assert.equal(s.unknownCost, 1);
  assert.equal(s.estimatedUsd, 0.01);
  assert.equal(s.accountedUsd, 0.03);
  assert.equal(s.ttftObserved, 1);
  assert.equal(summarizeLoad([]).estimatedUsd, null);
});
