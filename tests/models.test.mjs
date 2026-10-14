import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, validatePrice, normalizeResponse } from "../dist/accounting.js";
import { loadModels, selectModels } from "../dist/models.js";

const unknownPrice = {
  model: "gpt-6-luna", modelVersion: "2026-09-22", deploymentSku: "GlobalStandard",
  currency: "USD", inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null,
  effectiveFrom: "2026-10-14", effectiveTo: "2026-11-14",
  source: "https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/",
  status: "unconfigured"
};
const ctx = { model: unknownPrice.model, modelVersion: unknownPrice.modelVersion,
  deploymentSku: unknownPrice.deploymentSku, runId: "test", mode: "live", deployment: "gpt-6-luna", latencyMs: 10 };

test("known tokens with unconfigured model price are not zero USD", () => {
  validatePrice(unknownPrice, ctx, "2026-10-14");
  assert.equal(estimateCost({ prompt_tokens: 100, completion_tokens: 20 }, unknownPrice), null);
  const event = normalizeResponse({ usage: { prompt_tokens: 100, completion_tokens: 20 } }, ctx, unknownPrice);
  assert.equal(event.usageKnown, true);
  assert.equal(event.costKnown, false);
  assert.equal(event.estimatedCostUsd, null);
});
test("requested three models have distinct deployments and exact observed Azure versions", async () => {
  const models = await loadModels("config/models.json");
  assert.deepEqual(models.map(m => m.model), ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.6-terra"]);
  assert.equal(new Set(models.map(m => m.deployment)).size, 3);
  assert.equal(models[0].modelVersion, "2026-09-22");
  assert.ok(models.slice(1).every(m => m.modelVersion === "2026-07-09"));
});
test("model selection never silently substitutes an unknown deployment", async () => {
  const models = await loadModels("config/models.json");
  assert.equal(selectModels(models, "gpt-5.6-terra")[0].model, "gpt-5.6-terra");
  assert.throws(() => selectModels(models, "missing-model"), /Unknown deployment/);
  assert.throws(() => selectModels(models, "gpt-6-luna,gpt-6-luna"), /Duplicate/);
  assert.equal(selectModels(models, undefined).length, 3);
});
