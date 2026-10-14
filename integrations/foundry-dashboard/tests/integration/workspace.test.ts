// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildServer, resolveOpenAIResourceId } from "../../server/index.js";
import { readFile } from "node:fs/promises";
import { WorkspaceTelemetryAdapter, mapDependency, requestKql } from "../../server/adapters/workspace.js";
import type { QueryContext } from "../../server/adapters/types.js";

const ctx: QueryContext = {
  range: { from: "2026-10-14T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" },
  granularity: "15m", filters: {},
  table: { page: 1, pageSize: 25, dir: "desc", topN: 20 }, includeRaw: false,
};
const properties = {
  "telemetry.kind": "aoai.request", "demo.mode": "live",
  "gen_ai.request.model": "gpt-6-luna", "aoai.deployment": "luna",
  "aoai.model_version": "2026-09-22", "aoai.deployment_sku": "GlobalStandard",
  "aoai.outcome": "success", "aoai.status_code": "200",
  "aoai.prompt_tokens": "100", "aoai.completion_tokens": "20", "aoai.cached_tokens": "10",
  "aoai.streaming": "true", "aoai.ttft_ms": "12", "aoai.inter_chunk_mean_ms": "4",
  "aoai.stream_completed": "true", "aoai.price_status": "unconfigured",
  prompt: "SECRET PROMPT", error: "SECRET ERROR",
};
const row = { TimeGenerated: "2026-10-14T01:00:00.000Z", DurationMs: 100, Properties: properties };

describe("workspace reference dashboard", () => {
  it("accepts parent App Service environment without using App Insights as the source", () => {
    const openAI = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test/providers/Microsoft.CognitiveServices/accounts/test";
    expect(resolveOpenAIResourceId({ FOUNDRY_RESOURCE_ID: openAI,
      APPINSIGHTS_RESOURCE_ID: "/unused-application-insights" })).toBe(openAI);
    expect(resolveOpenAIResourceId({ AZURE_OPENAI_RESOURCE_ID: openAI })).toBe(openAI);
    expect(resolveOpenAIResourceId({ AZURE_OPENAI_RESOURCE_ID: "", FOUNDRY_RESOURCE_ID: openAI })).toBe(openAI);
    expect(() => resolveOpenAIResourceId({ FOUNDRY_RESOURCE_ID: openAI,
      AZURE_OPENAI_RESOURCE_ID: `${openAI}-different` })).toThrow(/conflict/i);
  });

  it("provides the requested compiled Azure startup script", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.scripts["start:azure"]).toBe("node build/server/index.js");
  });

  it("maps safe aoai fields without inventing absent usage or costs", () => {
    const request = mapDependency(row);
    expect(request).toMatchObject({ model: "gpt-6-luna", deployment: "luna", input: 100, output: 20,
      cached: 10, estimatedCostUsd: null, priceStatus: "unconfigured", streaming: true,
      ttftMs: 12, interChunkMeanMs: 4, streamCompleted: true });
    const missing = mapDependency({ ...row, Properties: { "telemetry.kind": "aoai.request" } });
    expect(missing.input).toBeNull();
    expect(missing.output).toBeNull();
    expect(missing.cached).toBeNull();
    expect(missing.estimatedCostUsd).toBeNull();
    expect(JSON.stringify(request)).not.toContain("SECRET");
  });

  it("queries only AppDependencies aoai.request live records with a safe projection", () => {
    const kql = requestKql(ctx);
    expect(kql).toContain("AppDependencies");
    expect(kql).toContain('Properties["telemetry.kind"]');
    expect(kql).toContain('Properties["demo.mode"]');
    expect(kql).not.toContain("workspace(");
    expect(kql).not.toMatch(/project .*Properties\s*$/m);
    expect(kql).not.toContain("Message");
  });

  it("preserves producer blocked/throttled/incomplete streaming outcome categories", async () => {
    const adapter = new WorkspaceTelemetryAdapter({ source: "fixture", readRows: async () =>
      ["input_blocked", "output_blocked", "throttled", "stream_incomplete", "stream_cancelled"].map(outcome => ({
        ...row, Properties: { ...properties, "aoai.outcome": outcome },
      })) });
    const requests = await adapter.requests(ctx);
    expect(requests.data.rows.map(row => row.outcome)).toEqual([
      "input_blocked", "output_blocked", "throttled", "stream_incomplete", "stream_cancelled"]);
    const errors = await adapter.recentErrors(ctx);
    expect(errors.data.rows.filter(row => row.errorType === "content_filter")).toHaveLength(2);
    expect(errors.data.rows.filter(row => row.errorType === "cancelled")).toHaveLength(1);
  });

  it("keeps missing usage null and separates historical ledger from current retail repricing", async () => {
    const adapter = new WorkspaceTelemetryAdapter({ source: "fixture", readRows: async () => [
      row, { ...row, Properties: { ...properties, "aoai.prompt_tokens": undefined, "aoai.outcome": "timeout" } },
    ] });
    const overview = await adapter.overview(ctx);
    expect(overview.data.totals.calls).toBe(2);
    expect(overview.data.totals.input).toBeNull();
    expect(overview.data.totals.estCost).toBeNull();
    expect(overview.data.totals.errorRate).toBe(0.5);
    const ledger = await adapter.requests(ctx);
    expect(ledger.data.rows[0].estimatedCostUsd).toBeNull();
    expect(ledger.data.rows[0].currentRetailCostUsd).toBeCloseTo(0.0000191);
    expect(ledger.data.rows[0].currentRetailPriceBasis).toContain("not invoice");
    expect(ledger.data.rows[1].currentRetailCostUsd).toBeNull();
  });

  it("does not reprice explicit unsupported billing scope while legacy unconfigured rows remain eligible", async () => {
    const adapter = new WorkspaceTelemetryAdapter({ source: "fixture", readRows: async () => [
      { ...row, Properties: { ...properties, "aoai.cost_reason": "price_scope_unsupported" } },
      row,
      { TimeGenerated: row.TimeGenerated, DurationMs: row.DurationMs, model: "gpt-6-luna",
        deployment: "luna", model_version: "2026-09-22", deployment_sku: "GlobalStandard",
        prompt_tokens: 100, completion_tokens: 20, cached_tokens: 10, price_status: "unconfigured",
        cost_reason: "price_scope_unsupported" },
    ] });
    const ledger = await adapter.requests(ctx);
    expect(ledger.data.rows[0].estimatedCostUsd).toBeNull();
    expect(ledger.data.rows[0].currentRetailCostUsd).toBeNull();
    expect(ledger.data.rows[0]).toMatchObject({ costReason: "price_scope_unsupported" });
    expect(ledger.data.rows[1].currentRetailCostUsd).toBeCloseTo(0.0000191);
    expect(ledger.data.rows[1]).toMatchObject({ costReason: null, priceStatus: "unconfigured" });
    expect(ledger.data.rows[2].currentRetailCostUsd).toBeNull();
    expect(requestKql(ctx)).toContain('Properties["aoai.cost_reason"]');
    expect(requestKql(ctx)).toContain('"price_scope_unsupported"');
  });

  it("does not use fixture data when live configuration is absent", async () => {
    const server = await buildServer({ env: {}, serveStatic: false });
    try {
      const response = await server.inject("/api/overview");
      expect(response.statusCode).toBe(503);
      expect(response.json().meta).toMatchObject({ source: "live", status: "error" });
      expect(response.json()).not.toHaveProperty("data");
    } finally { await server.close(); }
  });

  it("requires explicit fixture mode and rejects auto/mock modes", async () => {
    await expect(buildServer({ env: { DATA_SOURCE: "auto" } })).rejects.toThrow(/live.*fixture/);
    await expect(buildServer({ env: { DATA_SOURCE: "mock" } })).rejects.toThrow(/live.*fixture/);
    const server = await buildServer({ env: { DATA_SOURCE: "fixture" }, serveStatic: false });
    try {
      for (const route of ["/api/overview", "/api/meta", "/api/models", "/api/tokens/series",
        "/api/tokens/by-model", "/api/operations", "/api/cost/series", "/api/cost/by-model",
        "/api/latency/series", "/api/operations/errors/series", "/api/operations/recent-errors",
        "/api/requests", "/api/streaming", "/api/agents"]) {
        const result = await server.inject(route);
        expect(result.statusCode, route).toBe(200);
        expect(result.json().meta.source, route).toBe("fixture");
      }
      expect((await server.inject("/api/agents")).json().meta.warnings.join(" ")).toContain("not applicable");
    } finally { await server.close(); }
  });

  it("fails closed on upstream failures and never exposes Azure error bodies", async () => {
    const adapter = new WorkspaceTelemetryAdapter({ source: "live",
      readRows: async () => { throw new Error("private error SECRET"); } });
    const server = await buildServer({ env: {}, adapter, serveStatic: false });
    try {
      const response = await server.inject("/api/overview");
      expect(response.statusCode).toBe(502);
      expect(response.json().meta.source).toBe("live");
      expect(response.json()).not.toHaveProperty("data");
      expect(response.body).not.toContain("SECRET");
    } finally { await server.close(); }
  });
});
