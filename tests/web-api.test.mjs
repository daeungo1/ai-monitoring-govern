import assert from "node:assert/strict";
import test from "node:test";
import { handler, configureAlerts } from "../dist/web-api.js";

test("public HTTP API does not require a GitHub principal or owner setting", async () => {
  delete process.env.LOAD_GITHUB_OWNER;
  delete process.env.AOAI_ENDPOINT;
  const errors = [];
  const response = await handler({
    method: "GET", params: { path: "config" }, headers: new Headers(),
  }, { error: (...args) => errors.push(args) });
  assert.equal(response.status, 503, "anonymous caller reaches runtime initialization, not identity rejection");
  assert.equal(errors.length, 1);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(typeof response.jsonBody.error, "string");
});

test("alert read failures expose only safe operation and status, not ARM response content", async () => {
  const originalFetch = globalThis.fetch;
  process.env.LOAD_ALERT_RESOURCE_ROOT = "/subscriptions/test/providers/Microsoft.Insights/scheduledQueryRules";
  process.env.LOAD_OPENAI_ACCOUNT = "demo";
  globalThis.fetch = async () => new Response("sensitive upstream error", { status: 403 });
  try {
    await assert.rejects(configureAlerts({ credential: { getToken: async () => ({ token: "secret" }) } },
      "12345678-1234-1234-1234-123456789abc"), error => {
      assert.equal(error.status, 503);
      assert.match(error.message, /alert read.*403/i);
      assert.doesNotMatch(error.message, /sensitive|secret/);
      return true;
    });

  } finally { globalThis.fetch = originalFetch; }
});

test("alert configuration failures include bounded ARM codes without reflecting messages", async () => {
  const originalFetch = globalThis.fetch;
  process.env.LOAD_LOCATION = "eastus2";
  process.env.LOAD_WORKSPACE_RESOURCE_ID = "/workspace";
  process.env.LOAD_ACTION_GROUP_ID = "/actions";
  globalThis.fetch = async (_url, options) => options.method === "PUT"
    ? Response.json({ error: { code: "BadRequest", message: "secret raw content",
      details: [{ code: "InsufficientAccessError", message: "private diagnostic" }] } }, { status: 400 })
    : Response.json({ tags: { "demo-purpose": "continuous-scenarios" } });
  try {
    await assert.rejects(configureAlerts({ credential: { getToken: async () => ({ token: "secret" }) } },
      "12345678-1234-1234-1234-123456789abc"), error => {
      assert.match(error.message, /BadRequest.*InsufficientAccessError/);
      assert.doesNotMatch(error.message, /secret|raw content|private diagnostic/);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
