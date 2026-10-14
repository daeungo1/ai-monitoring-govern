import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoScenarioEvents, scenarioIntervalSeconds, scenarioDue, demoAlertPayload } from "../dist/demo-scenarios.js";
import { toAttributes } from "../dist/accounting.js";

const model = { deployment: "demo-model", model: "demo-model", modelVersion: "1", deploymentSku: "GlobalStandard" };
const price = { ...model, currency: "USD", inputPerMillion: 2, cachedInputPerMillion: 0.2,
  outputPerMillion: 12, effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01",
  source: "https://example.com/price", status: "verified" };
const workerId = "12345678-1234-4234-8234-123456789abc";

test("scenario replay is opt-in and rejects notification-spamming cadence", () => {
  assert.equal(scenarioIntervalSeconds(undefined), null);
  assert.equal(scenarioIntervalSeconds("3600"), 3600);
  for (const value of ["", "0", "60", "NaN", "3600.5", "86401"]) {
    assert.throws(() => scenarioIntervalSeconds(value), /interval/i);
  }
  assert.equal(scenarioDue(100, null, 3600), true);
  assert.equal(scenarioDue(3699, 100, 3600), false);
  assert.equal(scenarioDue(3700, 100, 3600), true);
  assert.equal(scenarioDue(9999, null, null), false);
});

test("scenario batches preserve source, worker correlation and all failure outcomes", () => {
  const events = createDemoScenarioEvents([model], new Map([[model.deployment, price]]), workerId);
  assert.equal(events.length, 9);
  assert.deepEqual(new Set(events.map(event => event.outcome)), new Set([
    "success", "input_blocked", "output_blocked", "throttled", "server_error",
    "filter_unavailable", "stream_incomplete", "stream_cancelled"
  ]));
  for (const event of events) {
    assert.equal(event.mode, "fixture");
    assert.equal(event.workload, "continuous-demo-scenarios");
    assert.equal(event.workerId, workerId);
    assert.equal(event.estimatedCostUsd, null);
    assert.equal(event.costKnown, false);
    assert.equal(event.priceStatus, "unconfigured");
    const attrs = toAttributes(event);
    assert.equal(attrs["demo.mode"], "fixture");
    assert.equal(attrs["demo.worker_id"], workerId);
    assert.ok(!("aoai.estimated_cost_usd" in attrs));
    assert.ok(!JSON.stringify(event).includes("safe fixture"));
  }
  assert.equal(new Set(events.map(event => event.runId)).size, 1);
  assert.throws(() => createDemoScenarioEvents([model], new Map(), workerId), /price/i);
});

test("demo alarm rules cannot observe live traffic or another worker", () => {
  for (const kind of ["guardrail", "throttle"]) {
    const body = demoAlertPayload(kind, workerId, {
      location: "eastus2", workspaceResourceId: "/subscriptions/demo/workspaces/test",
      actionGroupId: "/subscriptions/demo/actionGroups/test"
    });
    const props = body.properties;
    const criterion = props.criteria.allOf[0];
    assert.equal(props.enabled, true);
    assert.equal(props.autoMitigate, true);
    assert.equal(props.evaluationFrequency, "PT1M");
    assert.equal(props.windowSize, "PT5M");
    assert.equal(criterion.threshold, 0);
    assert.match(criterion.query, /demo.mode.*fixture/);
    assert.match(criterion.query, /continuous-demo-scenarios/);
    assert.ok(criterion.query.includes(workerId));
    assert.deepEqual(props.actions.actionGroups, ["/subscriptions/demo/actionGroups/test"]);
    assert.match(props.displayName, /SYNTHETIC DEMO/);
  }
  assert.throws(() => demoAlertPayload("throttle", "injected' | take 1", {}), /worker/i);
});

test("daily cost alarm uses 70 percent of live conservative budget, not synthetic costs", () => {
  const body = demoAlertPayload("budget", workerId, {
    location: "eastus2", workspaceResourceId: "workspace", actionGroupId: "actions"
  });
  const query = body.properties.criteria.allOf[0].query;
  assert.match(query, /aoai.budget/);
  assert.match(query, /demo.mode.*live/);
  assert.match(query, /demo.budget_utilization.*>= 0.7/);
  assert.ok(!query.includes('demo.mode"] == "fixture"'));
});

test("web synthetic alerts cover concurrent runs without a daily budget alarm", () => {
  const settings = { location: "eastus2", workspaceResourceId: "workspace",
    actionGroupId: "actions", scope: "web" };
  for (const kind of ["guardrail", "throttle"]) {
    const body = demoAlertPayload(kind, workerId, settings);
    const query = body.properties.criteria.allOf[0].query;
    assert.match(query, /web-demo-scenarios/);
    assert.ok(!query.includes(workerId));
    assert.equal(body.properties.enabled, true);
  }
  assert.equal(demoAlertPayload("budget", workerId, settings).properties.enabled, false);
  const events = createDemoScenarioEvents([model], new Map([[model.deployment, price]]),
    workerId, "web-demo-scenarios");
  assert.ok(events.every(event => event.workload === "web-demo-scenarios"));
});
