import { randomUUID } from "node:crypto";
import type { PriceCard, RequestEvent } from "./accounting.js";
import type { ModelConfig } from "./models.js";
import { fixtures } from "./fixtures.js";
import { replayFixture } from "./replay.js";

export function scenarioIntervalSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 900 || interval > 86400) {
    throw new Error("Demo scenario interval must be 900..86400 seconds.");
  }
  return interval;
}

export function scenarioDue(now: number, last: number | null, interval: number | null): boolean {
  return interval !== null && (last === null || now - last >= interval);
}

export function createDemoScenarioEvents(models: ModelConfig[], prices: Map<string, PriceCard>,
  workerId: string, workload: "continuous-demo-scenarios" | "web-demo-scenarios" = "continuous-demo-scenarios"): RequestEvent[] {
  const runId = randomUUID();
  return models.flatMap(model => {
    const price = prices.get(model.deployment);
    if (!price) throw new Error("Demo scenario price metadata missing.");
    const fixturePrice: PriceCard = { ...price, status: "unconfigured",
      inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null };
    return fixtures.map(fixture => replayFixture(fixture, {
      ...model, runId, workerId, mode: "fixture", workload,
      profile: fixture.name, latencyMs: 0,
    }, fixturePrice));
  });
}

export interface DemoAlertSettings {
  location: string;
  workspaceResourceId: string;
  actionGroupId: string;
  scope?: "worker" | "web";
}

export function demoAlertPayload(kind: "guardrail" | "throttle" | "budget", workerId: string,
  settings: DemoAlertSettings) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(workerId)) {
    throw new Error("Invalid demo alert worker UUID.");
  }
  const source = kind === "budget"
    ? '| where Properties["telemetry.kind"] == "aoai.budget" and Properties["demo.mode"] == "live"\n'
      + '| where todouble(Properties["demo.budget_utilization"]) >= 0.7'
    : '| where Properties["telemetry.kind"] == "aoai.request" and Properties["demo.mode"] == "fixture"\n'
      + `| where Properties["demo.workload"] == "${settings.scope === "web" ? "web-demo-scenarios" : "continuous-demo-scenarios"}"\n`
      + (kind === "guardrail"
        ? '| where Properties["aoai.outcome"] in ("input_blocked", "output_blocked", "filter_unavailable")'
        : '| where toint(Properties["aoai.status_code"]) == 429');
  const query = `AppDependencies\n| where TimeGenerated > ago(5m)\n${source}\n`
    + (settings.scope === "web" ? "" : `| where Properties["demo.worker_id"] == "${workerId}"`);
  return {
    location: settings.location, kind: "LogAlert",
    tags: { environment: "demo", "demo-worker": workerId, "demo-purpose": "continuous-scenarios" },
    properties: {
      displayName: `${kind === "budget" ? "DEMO LIVE BUDGET 70%" : "SYNTHETIC DEMO"} ${kind}`,
      description: kind === "budget"
        ? "70% of daily conservative USD retail estimate limit. Not invoiced Azure spend."
        : "Synthetic fixture replay only. Not a real Azure model block or outage.",
      enabled: !(settings.scope === "web" && kind === "budget"),
      severity: 3, evaluationFrequency: "PT1M", windowSize: "PT5M",
      scopes: [settings.workspaceResourceId], autoMitigate: true, skipQueryValidation: false,
      criteria: { allOf: [{ query, timeAggregation: "Count", operator: "GreaterThan", threshold: 0,
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 } }] },
      actions: { actionGroups: [settings.actionGroupId],
        customProperties: { demoSource: kind === "budget" ? "live-retail-estimate" : "synthetic-fixture", workerId } },
    },
  };
}
