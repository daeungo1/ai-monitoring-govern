import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamingCollector } from "../dist/streaming.js";
import { toAttributes } from "../dist/accounting.js";

const price = { model: "test", modelVersion: "v1", deploymentSku: "GlobalStandard", currency: "USD",
  inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2,
  effectiveFrom: "2026-10-14", effectiveTo: "2026-11-14", source: "https://example.com", status: "illustrative" };
const context = { runId: "stream-test", mode: "live", deployment: "test", model: "test", modelVersion: "v1",
  deploymentSku: "GlobalStandard", latencyMs: 0 };
const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } };
test("stream TTFT waits for visible content, final usage arrives after finish reason", () => {
  const collector = new StreamingCollector(context, price);
  collector.accept({ choices: [{ delta: { role: "assistant", content: "" } }] }, 20);
  collector.accept({ choices: [{ delta: { content: "hello" } }] }, 100);
  collector.accept({ choices: [{ delta: { content: "world" } }] }, 150);
  collector.accept({ choices: [{ finish_reason: "stop", delta: {} }] }, 180);
  collector.accept({ usage, choices: [] }, 200);
  const event = collector.finish(210);
  assert.equal(event.outcome, "success");
  assert.equal(event.stream.firstChunkMs, 20);
  assert.equal(event.stream.ttftMs, 100);
  assert.equal(event.stream.interChunkMeanMs, 50);
  assert.equal(event.stream.durationMs, 210);
  assert.equal(event.stream.chunkCount, 5);
  assert.equal(event.stream.completed, true);
  assert.equal(event.usageKnown, true);
  assert.equal(event.estimatedCostUsd, 0.000135);
  assert.ok(!JSON.stringify(event).includes("hello"));
  assert.ok(!JSON.stringify(event).includes("world"));
  assert.equal(toAttributes(event)["aoai.ttft_ms"], 100);
});
test("missing final usage remains null despite a normal stream finish", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ choices: [{ finish_reason: "stop" }] }, 50);
  const e = c.finish(60);
  assert.equal(e.usageKnown, false);
  assert.equal(e.estimatedCostUsd, null);
  assert.equal(e.stream.ttftMs, null);
});
test("an exhausted stream without finish reason is incomplete rather than success", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ choices: [{ delta: { content: "safe text" } }] }, 10);
  assert.equal(c.finish(20).outcome, "stream_incomplete");
});
test("explicit cancellation and mid-stream network failure are distinct", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ choices: [{ delta: { content: "safe" } }] }, 10);
  assert.equal(c.finish(20, { kind: "cancelled", error: new Error("private") }).outcome, "stream_cancelled");
  assert.equal(c.finish(20, { kind: "error", error: new Error("private") }).outcome, "network_error");
});
test("stream output blocking and filter service failure preserve annotations", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ choices: [{ finish_reason: "content_filter",
    content_filter_results: { violence: { filtered: true, severity: "medium" } } }] }, 50);
  assert.equal(c.finish(60).outcome, "output_blocked");
  assert.equal(c.finish(60).filters[0].category, "violence");
  const failed = new StreamingCollector(context, price);
  failed.accept({ choices: [{ finish_reason: "stop", content_filter_results: { error: { code: "failed" } } }] }, 50);
  assert.equal(failed.finish(60).outcome, "filter_unavailable");
});
test("duplicate annotations do not inflate observation counts", () => {
  const c = new StreamingCollector(context, price);
  const chunk = { choices: [{ content_filter_results: { hate: { filtered: false, severity: "safe" } } }] };
  c.accept(chunk, 20); c.accept(chunk, 30); c.accept({ choices: [{ finish_reason: "stop" }] }, 40);
  assert.equal(c.finish(50).filters.length, 1);
});
test("usage already received is retained if transport fails afterwards", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ usage, choices: [] }, 20);
  const event = c.finish(30, { kind: "error", error: new Error("network") });
  assert.equal(event.outcome, "network_error");
  assert.equal(event.usageKnown, true);
  assert.equal(event.estimatedCostUsd, 0.000135);
});
test("content-filter exception after partial stream is an output block", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ choices: [{ delta: { content: "safe text" } }] }, 20);
  assert.equal(c.finish(30, { kind: "error", error: {
    status: 400, error: { code: "content_filter" }
  } }).outcome, "output_blocked");
});
test("stream reconstruction preserves unknown cost for unsupported cache-write accounting", () => {
  const c = new StreamingCollector(context, price);
  c.accept({ usage: { ...usage, prompt_tokens_details: { cached_tokens: 0, cache_creation_tokens: 50 } },
    choices: [] }, 20);
  c.accept({ choices: [{ finish_reason: "stop" }] }, 30);
  assert.equal(c.finish(40).costKnown, false);
  assert.equal(c.finish(40).estimatedCostUsd, null);
});
