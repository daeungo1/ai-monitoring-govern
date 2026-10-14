// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OpenAIPlatformAdapter } from "../../server/adapters/openai-platform.js";
import type { QueryContext } from "../../server/adapters/types.js";

const ctx: QueryContext = { range: { from: "2026-10-14T00:00:00Z", to: "2026-10-15T00:00:00Z" },
  granularity: "15m", filters: {}, includeRaw: false, table: { page: 1, pageSize: 25, topN: 20, dir: "desc" } };
const resource = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test/providers/Microsoft.CognitiveServices/accounts/test";
const credential = { getToken: async () => ({ token: "test-only-token", expiresOnTimestamp: Date.now() + 60000 }) };
const values = [
  ["AzureOpenAIRequests", 4], ["ProcessedPromptTokens", 400], ["GeneratedTokens", 80],
].map(([name, total]) => ({ name: { value: name }, timeseries: [{
  metadatavalues: [{ name: { value: "ModelDeploymentName" }, value: "deployment-a" }],
  data: [{ timeStamp: "2026-10-14T01:00:00Z", total }],
}] }));

describe("OpenAI account ARM metrics", () => {
  it("uses only configured account ARM resource and supported OpenAI metrics", async () => {
    let queried = "";
    const fetcher = (async (url: URL) => { queried = url.toString(); return new Response(JSON.stringify({ value: values })); }) as typeof fetch;
    const adapter = new OpenAIPlatformAdapter(resource, credential, "live", fetcher);
    const result = await adapter.usage(ctx);
    expect(result.data).toMatchObject({ requests: 4, inputTokens: 400, outputTokens: 80, totalTokens: 480,
      cachedTokens: null, estCost: null });
    expect(queried).toContain(`management.azure.com${resource}/providers/microsoft.insights/metrics`);
    expect(decodeURIComponent(queried)).toContain("AzureOpenAIRequests,ProcessedPromptTokens,GeneratedTokens");
    expect((await adapter.byModel(ctx)).data.rows[0].model).toBe("deployment-a");
    expect((await adapter.usageSeries(ctx)).data.points[0].totalTokens).toBe(480);
  });
  it("fails closed on native metrics errors and missing metrics", async () => {
    for (const response of [new Response("private body", { status: 403 }), new Response('{"value":[]}')]) {
      const fetcher = (async () => response) as typeof fetch;
      await expect(new OpenAIPlatformAdapter(resource, credential, "live", fetcher).usage(ctx)).rejects.toThrow(/unavailable/);
    }
  });
  it("never fetches Azure in fixture mode and does not report native zeroes", async () => {
    const fetcher = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
    const data = await new OpenAIPlatformAdapter(undefined, credential, "fixture", fetcher).usage(ctx);
    expect(data.data.requests).toBeNull();
    expect(data.warnings.join(" ")).toContain("Fixture");
  });
});
