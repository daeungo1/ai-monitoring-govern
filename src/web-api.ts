import { app, type HttpRequest, type InvocationContext, type HttpResponseInit } from "@azure/functions";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import { record } from "./accounting.js";
import { createDemoScenarioEvents, demoAlertPayload } from "./demo-scenarios.js";
import { invokeLoad } from "./load-api.js";
import { loadModels, loadPriceCards } from "./models.js";
import { Telemetry } from "./telemetry.js";
import { WebError } from "./web-policy.js";
import { WebService } from "./web-service.js";
import { BlobWebStore } from "./web-store.js";

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server setting: ${name}`);
  return value;
}
async function initialize() {
  const credential = new DefaultAzureCredential();
  const models = await loadModels("config/models.json");
  if (models.length !== 3) throw new Error("Web demo requires exactly three configured deployments.");
  const prices = await loadPriceCards("config/model-prices.json", models);
  const endpoint = new URL(setting("AOAI_ENDPOINT"));
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".openai.azure.com")) {
    throw new Error("Untrusted model endpoint.");
  }
  const seed = Number(setting("LOAD_INITIAL_ACCOUNTED_USD"));
  if (!Number.isFinite(seed) || seed < 0) throw new Error("Invalid initial budget.");
  const store = new BlobWebStore(setting("LOAD_STATE_CONTAINER_URL"), credential, seed, setting("LOAD_INITIAL_DAY"));
  return {
    credential, store, service: new WebService(store, models, prices),
    telemetry: new Telemetry(setting("APPLICATIONINSIGHTS_CONNECTION_STRING")),
    client: new AzureOpenAI({ endpoint: endpoint.href, apiVersion: "2024-10-21", timeout: 25000, maxRetries: 0,
      azureADTokenProvider: getBearerTokenProvider(credential, "https://cognitiveservices.azure.com/.default") }),
  };
}
let runtime: ReturnType<typeof initialize> | undefined;
async function getRuntime() {
  if (!runtime) runtime = initialize();
  try { return await runtime; }
  catch (error) { runtime = undefined; throw error; }
}
async function jsonBody(request: HttpRequest): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 16000) throw new WebError(413, "Request body exceeds demo limits.");
  try { return JSON.parse(text); }
  catch { throw new WebError(400, "Invalid JSON body."); }
}
function reply(jsonBody: unknown, status = 200): HttpResponseInit {
  return { status, jsonBody, headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } };
}
async function alertFailure(response: Response, operation: string): Promise<WebError> {
  const codes = new Set<string>();
  if (response.headers.get("content-type")?.includes("application/json")) {
    const visit = (value: unknown, depth: number): void => {
      if (depth > 3 || codes.size >= 8) return;
      const error = record(value);
      if (typeof error.code === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.code)) codes.add(error.code);
      if (typeof error.message === "string") {
        for (const code of ["InsufficientAccessError", "AuthorizationFailed", "LinkedAuthorizationFailed",
          "InvalidQuery", "SemanticError", "BadArgumentError"]) {
          if (error.message.includes(code)) codes.add(code);
        }
      }
      if (Array.isArray(error.details)) error.details.slice(0, 8).forEach(detail => visit(detail, depth + 1));
      if (error.innererror) visit(error.innererror, depth + 1);
    };
    visit(record(await response.json()).error, 0);
  }
  return new WebError(503, `Demo alert ${operation} failed (HTTP ${response.status}; ${[...codes].join(", ") || "no ARM code"}). Check alert and linked workspace/action group permissions.`);
}
export async function configureAlerts(rt: Pick<Awaited<ReturnType<typeof initialize>>, "credential">, workerId: string): Promise<void> {
  const token = await rt.credential.getToken("https://management.azure.com/.default");
  if (!token) throw new Error("Azure alert authorization unavailable.");
  const signal = AbortSignal.timeout(15000);
  for (const kind of ["guardrail", "throttle", "budget"] as const) {
    const id = `${setting("LOAD_ALERT_RESOURCE_ROOT")}/${setting("LOAD_OPENAI_ACCOUNT")}-demo-${kind}`;
    const url = `https://management.azure.com${id}?api-version=2023-12-01`;
    const headers = { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" };
    const previous = await fetch(url, { headers, signal });
    if (!previous.ok) throw await alertFailure(previous, "read");
    const existing = record(await previous.json());
    if (record(existing.tags)["demo-purpose"] !== "continuous-scenarios") throw new Error("Alert ownership mismatch.");
    const payload = demoAlertPayload(kind, workerId, {
      location: setting("LOAD_LOCATION"), workspaceResourceId: setting("LOAD_WORKSPACE_RESOURCE_ID"),
      actionGroupId: setting("LOAD_ACTION_GROUP_ID"),
      scope: "web",
    });
    const response = await fetch(url, { method: "PUT", headers, body: JSON.stringify(payload),
      signal });
    if (!response.ok) throw await alertFailure(response, `configuration (${kind})`);
  }
}

export async function handler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const path = request.params.path ?? "";
    const rt = await getRuntime();
    if (request.method === "GET" && path === "config") return reply(await rt.service.config());
    if (request.method === "POST" && path === "runs") {
      const run = await rt.service.start(await jsonBody(request));
      try {
        await configureAlerts(rt, run.runId);
        rt.telemetry.emitBudget(run.budget.accountedUsd, run.budget.limitUsd, run.runId);
        if (run.fixtures) {
          for (const event of createDemoScenarioEvents(rt.service.models, rt.service.prices, run.runId,
            "web-demo-scenarios")) rt.telemetry.emit(event);
        }
        await rt.telemetry.flush();
      } catch (error) {
        await rt.service.stop(run.runId);
        throw error;
      }
      return reply({ runId: run.runId, plan: run.plan, status: run.status, budget: run.budget, expiresAt: run.expiresAt });
    }
    const match = /^runs\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(?:\/(stop|calls\/(\d{1,3})))?$/i.exec(path);
    if (!match?.[1]) throw new WebError(404, "Unknown API route.");
    const runId = match[1];
    if (request.method === "GET" && !match[2]) {
      const status = await rt.service.status(runId);
      rt.telemetry.emitBudget(status.budget.accountedUsd, status.budget.limitUsd, runId);
      await rt.telemetry.flush();
      return reply(status);
    }
    if (request.method === "POST" && match[2] === "stop") return reply(await rt.service.stop(runId));
    if (request.method !== "POST" || match[3] === undefined) throw new WebError(405, "Method not allowed.");
    const index = Number(match[3]);
    const body = record(await jsonBody(request));
    if (typeof body.prompt !== "string" || Buffer.byteLength(body.prompt) > 3500) throw new WebError(400, "Invalid input.");
    const { run, model, price } = await rt.service.admit(runId, index, body.prompt);
    const event = await invokeLoad(rt.client, { ...model, runId, workerId: runId, mode: "live",
      workload: "web-load-test", profile: "web-configured", requestedMaxTokens: run.outputTokens,
      inputChars: run.inputChars, latencyMs: 0 }, price,
    { id: "web-configured", contextRepeats: 1, outputTokens: run.outputTokens, callsPerModel: 1 },
    body.prompt, AbortSignal.timeout(25000));
    await rt.service.complete(runId, index, event);
    rt.telemetry.emit(event);
    await rt.telemetry.flush();
    return reply({ event });
  } catch (error) {
    if (error instanceof WebError) return reply({ error: error.message }, error.status);
    context.error("Load controller failed. No raw input/output logged.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return reply({ error: "Server operation failed. Inspect Application Insights; new requests must be stopped." }, 503);
  }
}

app.http("loadController", { methods: ["GET", "POST"], authLevel: "anonymous", route: "{*path}", handler });
