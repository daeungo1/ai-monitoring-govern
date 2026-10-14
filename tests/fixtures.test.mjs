import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtures } from "../dist/fixtures.js";
import { replayFixture } from "../dist/replay.js";
import { readFile } from "node:fs/promises";

test("safe fixtures include cancellation and incomplete streaming outcomes", async () => {
  const price = JSON.parse(await readFile("config/prices.json", "utf8"));
  const context = { runId: "fixture-test", mode: "fixture", deployment: "chat-demo",
    model: price.model, modelVersion: price.modelVersion, deploymentSku: price.deploymentSku, latencyMs: 25 };
  const events = fixtures.map(f => replayFixture(f, context, price));
  assert.equal(events.length, 9);
  assert.deepEqual(events.map(e => e.outcome), [
    "success", "input_blocked", "output_blocked", "throttled", "server_error", "filter_unavailable", "success",
    "stream_cancelled", "stream_incomplete"
  ]);
  assert.equal(events.filter(e => e.usageKnown).length, 3);
  assert.ok(events.every(e => e.mode === "fixture"));
  assert.ok(!JSON.stringify(events).includes('"content":'));
  assert.ok(!JSON.stringify(events).includes("safe fixture"));
});
