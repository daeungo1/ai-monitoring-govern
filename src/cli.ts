import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AzureCliCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import { normalizeResponse, validatePrice, type RequestContext, type RequestEvent } from "./accounting.js";
import { fixtures } from "./fixtures.js";
import { Telemetry } from "./telemetry.js";
import { loadModels, selectModels, loadPriceCards } from "./models.js";
import { StreamingCollector, type StreamFailure } from "./streaming.js";
import { replayFixture } from "./replay.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable missing: ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!["offline", "live", "replay"].includes(mode ?? "")) {
    throw new Error("Usage: node dist/cli.js offline|live|replay");
  }
  const models = selectModels(await loadModels(process.env.MODEL_CONFIG_FILE ?? "config/models.json"),
    process.env.DEMO_DEPLOYMENTS);
  const prices = await loadPriceCards(process.env.MODEL_PRICE_FILE ?? "config/model-prices.json", models);
  const fixturePrice: unknown = JSON.parse(await readFile("config/prices.json", "utf8"));
  const first = models[0];
  if (!first) throw new Error("No deployments selected.");
  const context: RequestContext = {
    runId: randomUUID(), mode: mode === "live" ? "live" : "fixture",
    deployment: first.deployment, model: first.model,
    modelVersion: first.modelVersion, deploymentSku: first.deploymentSku,
    latencyMs: 0,
  };
  validatePrice(fixturePrice, { model: "gpt-5-nano", modelVersion: "2025-08-07", deploymentSku: "GlobalStandard" });
  const telemetry = mode === "offline" ? null : new Telemetry(required("APPLICATIONINSIGHTS_CONNECTION_STRING"));
  const events: RequestEvent[] = [];
  let failed = false;
  try {
    if (mode === "live") {
      const endpoint = new URL(required("AZURE_OPENAI_ENDPOINT"));
      if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".openai.azure.com")) {
        throw new Error("Expected a trusted Azure OpenAI HTTPS endpoint.");
      }
      const credential = new AzureCliCredential();
      const client = new AzureOpenAI({
        endpoint: endpoint.href,
        apiVersion: "2024-10-21",
        azureADTokenProvider: getBearerTokenProvider(credential, "https://cognitiveservices.azure.com/.default"),
        maxRetries: 0, timeout: 60000,
      });
      const count = Number(process.env.DEMO_REQUEST_COUNT ?? 1);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("DEMO_REQUEST_COUNT must be 1..20.");
      for (const model of models) {
        const price = prices.get(model.deployment);
        if (!price) throw new Error(`Price configuration missing: ${model.deployment}.`);
        for (let i = 0; i < count; i++) {
          const started = performance.now();
          const modelContext = { ...context, deployment: model.deployment, model: model.model,
            modelVersion: model.modelVersion, deploymentSku: model.deploymentSku };
          const collector = new StreamingCollector(modelContext, price);
          let failure: StreamFailure | undefined;
          try {
            const stream = await client.chat.completions.create({
              model: model.deployment,
              messages: [{ role: "user", content: "Count from 1 to 20, separated by spaces. Do not include any explanation." }],
              max_completion_tokens: 128,
              stream: true, stream_options: { include_usage: true },
            });
            for await (const chunk of stream) {
              collector.accept(chunk, Math.max(0, Math.round(performance.now() - started)));
              if (process.env.DEMO_CANCEL_AFTER_FIRST_CHUNK === "true") {
                stream.controller.abort();
                failure = { kind: "cancelled", error: new Error("Explicit demo cancellation.") };
                break;
              }
            }
          } catch (caught: unknown) {
            failure = { kind: "error", error: caught };
          }
          const event = collector.finish(Math.max(1, Math.round(performance.now() - started)), failure);
          events.push(event);
          telemetry?.emit(event);
          console.log(JSON.stringify(event));
          failed ||= event.outcome !== "success";
        }
      }
    } else {
      for (const model of models) {
        const price = prices.get(model.deployment);
        if (!price) throw new Error(`Price configuration missing: ${model.deployment}.`);
        for (const fixture of fixtures) {
          const event = replayFixture(fixture, { ...context, deployment: model.deployment, model: model.model,
            modelVersion: model.modelVersion, deploymentSku: model.deploymentSku }, price);
          events.push(event);
          telemetry?.emit(event);
          console.log(JSON.stringify({ scenario: fixture.name, ...event }));
        }
      }
      const estimate = normalizeResponse(fixtures[0].response,
        { ...context, deployment: "illustrative-cost-example", model: "gpt-5-nano", modelVersion: "2025-08-07" },
        fixturePrice);
      console.log(JSON.stringify({ accountingExampleOnly: true, exported: false, estimatedUsd: estimate.estimatedCostUsd,
        note: "Illustrative standalone math example; not a requested model price or actual bill." }));
    }
  } finally {
    await telemetry?.close();
  }
  await mkdir("artifacts", { recursive: true });
  const summary = {
    runId: context.runId, mode: context.mode, exported: telemetry !== null,
    timestamp: new Date().toISOString(), events,
    knownUsage: events.filter(e => e.usageKnown).length,
    unknownUsage: events.filter(e => !e.usageKnown).length,
    estimatedUsd: events.some(e => e.costKnown) ? events.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0) : null,
    costCoverage: { known: events.filter(e => e.costKnown).length, unknown: events.filter(e => !e.costKnown).length },
    modelCount: models.length,
  };
  await writeFile(`artifacts/${context.runId}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ runId: context.runId, mode: context.mode, exported: telemetry !== null }));
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unrecognized execution failure.";
  console.error(`Demo failed: ${message}`);
  process.exitCode = 1;
});
