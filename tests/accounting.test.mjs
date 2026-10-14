import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, normalizeResponse, normalizeError, toAttributes, validatePrice } from "../dist/accounting.js";

const price = {
  model: "gpt-4o-mini", modelVersion: "2024-07-18", deploymentSku: "GlobalStandard",
  currency: "USD", inputPerMillion: 0.15, cachedInputPerMillion: 0.075,
  outputPerMillion: 0.6, effectiveFrom: "2026-10-14", effectiveTo: "2026-11-14",
  source: "https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/",
  status: "illustrative"
};
const context = { runId: "test-run", mode: "live", deployment: "chat-demo", model: price.model,
  modelVersion: price.modelVersion, deploymentSku: price.deploymentSku, latencyMs: 25 };
const response = {
  model: "gpt-4o-mini-2024-07-18",
  usage: { prompt_tokens: 1000, completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 400 }, completion_tokens_details: { reasoning_tokens: 100 } },
  choices: [{ finish_reason: "stop", message: { content: "PRIVATE_RESPONSE" },
    content_filter_results: { hate: { filtered: false, severity: "safe" } } }],
  prompt_filter_results: [{ prompt_index: 0, content_filter_results: {
    violence: { filtered: false, severity: "low" } } }]
};

test("charges cached prompt tokens once and reasoning inside completion once", () => {
  assert.equal(estimateCost(response.usage, price), 0.00024);
});
test("unknown usage is null, never a free request", () => {
  assert.equal(estimateCost(undefined, price), null);
});
test("zero tokens is a known zero cost", () => {
  assert.equal(estimateCost({ prompt_tokens: 0, completion_tokens: 0 }, price), 0);
});
test("invalid usage fails explicitly", () => {
  for (const usage of [
    { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 2.5, completion_tokens: 2 },
    { prompt_tokens: 2, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 } },
    { prompt_tokens: NaN, completion_tokens: 2 }
  ]) assert.throws(() => estimateCost(usage, price), /tokens/);
});
test("price rejects negative, infinite, expired and mismatched rate cards", () => {
  for (const changed of [
    { inputPerMillion: -1 }, { outputPerMillion: Infinity }, { effectiveTo: "2026-10-13" },
    { modelVersion: "wrong" }, { deploymentSku: "Standard" }, { currency: "KRW" }
  ]) assert.throws(() => validatePrice({ ...price, ...changed }, context, "2026-10-14"), /price/i);
});
test("input block reads Azure error envelope without persisting private error message", () => {
  const event = normalizeError({
    status: 400, error: { code: "content_filter", message: "PRIVATE_PROMPT",
      innererror: { code: "ResponsibleAIPolicyViolation",
        content_filter_result: { violence: { filtered: true, severity: "high" } } } }
  }, context, price);
  assert.equal(event.outcome, "input_blocked");
  assert.equal(event.usageKnown, false);
  assert.equal(event.estimatedCostUsd, null);
  assert.equal(event.filters[0].category, "violence");
  assert.ok(!JSON.stringify(event).includes("PRIVATE"));
});
test("HTTP 200 with content_filter finish reason is an output block", () => {
  const event = normalizeResponse({ ...response, choices: [
    { finish_reason: "content_filter", content_filter_results: {
      sexual: { filtered: true, severity: "medium" } } }] }, context, price);
  assert.equal(event.statusCode, 200);
  assert.equal(event.outcome, "output_blocked");
  assert.equal(event.estimatedCostUsd, 0.00024);
});
test("filter service failure is not a safe verdict", () => {
  const event = normalizeResponse({ ...response, choices: [
    { finish_reason: "stop", content_filter_results: { error: { code: "content_filter_error" } } }] }, context, price);
  assert.equal(event.outcome, "filter_unavailable");
});
test("missing annotations means unobserved rather than verified safe", () => {
  const event = normalizeResponse({ usage: response.usage, choices: [{ finish_reason: "stop" }] }, context, price);
  assert.equal(event.filterObserved, false);
  assert.equal(event.outcome, "success");
});
test("429, 401, server error and network error remain distinct", () => {
  assert.equal(normalizeError({ status: 429, error: { message: "PRIVATE" } }, context, price).outcome, "throttled");
  assert.equal(normalizeError({ status: 401 }, context, price).outcome, "client_error");
  assert.equal(normalizeError({ status: 503 }, context, price).outcome, "server_error");
  assert.equal(normalizeError(new Error("PRIVATE"), context, price).outcome, "network_error");
});
test("telemetry allowlist excludes message, prompt, arbitrary keys and object serialization", () => {
  const event = normalizeResponse(response, context, price);
  const attrs = toAttributes({ ...event, prompt: "PRIVATE", response: "PRIVATE" });
  assert.equal(attrs["demo.mode"], "live");
  assert.equal(attrs["aoai.estimated_cost_usd"], 0.00024);
  assert.ok(!JSON.stringify(attrs).includes("PRIVATE"));
  assert.equal(attrs["aoai.usage_known"], true);
});
test("filter annotations alone can mark an output as blocked", () => {
  const event = normalizeResponse({ ...response, choices: [
    { finish_reason: "stop", content_filter_results: {
      protected_material_text: { filtered: true, detected: true } } }] }, context, price);
  assert.equal(event.outcome, "output_blocked");
});
test("missing usage preserves outcome and marks accounting incomplete", () => {
  const event = normalizeResponse({ choices: [{ finish_reason: "length" }] }, context, price);
  assert.equal(event.outcome, "success");
  assert.equal(event.usageKnown, false);
  assert.equal(event.estimatedCostUsd, null);
});
test("short-context price is not applied outside its approved demo prompt scope", () => {
  assert.equal(estimateCost({ prompt_tokens: 5000, completion_tokens: 20 },
    { ...price, maxPromptTokens: 4096 }), null);
});
test("unimplemented cache-write billing is unknown rather than treated as ordinary input", () => {
  assert.equal(estimateCost({ prompt_tokens: 100, completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 0, cache_creation_tokens: 50 } }, price), null);
});
