import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const dashboard = await readJson("infra/grafana-dashboard.json");
const native = dashboard.panels.filter(p => p.targets?.some(t => t.queryType === "Azure Monitor"));
const logs = dashboard.panels.filter(p => p.targets?.some(t => t.queryType === "Azure Log Analytics"));
const metrics = [
  "AzureOpenAIRequests", "ProcessedPromptTokens", "GeneratedTokens", "TokenTransaction",
  "AzureOpenAITTLTInMS", "AzureOpenAINormalizedTTFTInMS", "AzureOpenAINormalizedTBTInMS",
];

test("Grafana has 8 native, 18 LAW and one scope guide without removing existing panels", () => {
  assert.equal(native.length, 8);
  assert.equal(logs.length, 18);
  assert.equal(dashboard.panels.length, 27);
  assert.equal(new Set(dashboard.panels.map(p => p.id)).size, 27);
  assert.equal(dashboard.panels.filter(p => p.type === "text").length, 1);
});

test("native queries use current Azure Monitor schema and observed dimension definitions", () => {
  for (const panel of native) {
    const target = panel.targets[0];
    const query = target.azureMonitor;
    assert.equal(target.datasource.uid, "aoai-azure-monitor");
    assert.equal(target.subscription, query.resources[0].subscription);
    assert.equal(query.metricNamespace, "Microsoft.CognitiveServices/accounts");
    assert.ok(metrics.includes(query.metricName), query.metricName);
    assert.equal(query.resources[0].resourceName, "aoaimon20261014d-aoai");
    assert.equal(query.resources[0].region, "eastus2");
    assert.equal(query.timeGrain, "PT5M");
    assert.equal(query.dimensionFilters.find(d => d.dimension === "ModelDeploymentName").filters[0], "${deployment:raw}");
    assert.ok(query.dimensionFilters.every(d => d.operator === "eq" && Array.isArray(d.filters)));
    assert.ok(!JSON.stringify(query).match(/BlockedCalls|"Latency"|Provisioned|percentile|PTU/));
    assert.match(panel.description, /ignores.*mode.*run/i);
    assert.ok(panel.fieldConfig.defaults.links.some(l => l.title === "Azure Metrics"));
  }
  const requestQueries = native.filter(p => p.targets[0].azureMonitor.metricName === "AzureOpenAIRequests");
  assert.equal(requestQueries.length, 2);
  assert.ok(requestQueries.some(p => p.targets[0].azureMonitor.dimensionFilters.some(d => d.dimension === "StatusCode" && d.filters[0] === "*")));
  for (const name of metrics) assert.ok(native.some(p => p.targets[0].azureMonitor.metricName === name), name);
});

test("native latency is Average, not fabricated percentiles or client-visible TTFT", () => {
  for (const panel of native.filter(p => /InMS$/.test(p.targets[0].azureMonitor.metricName))) {
    assert.equal(panel.targets[0].azureMonitor.aggregation, "Average");
    assert.equal(panel.fieldConfig.defaults.unit, "ms");
    assert.match(panel.description, /availability|tier/i);
    assert.ok(!/p95|p99/i.test(panel.title));
  }
  assert.match(native.find(p => p.targets[0].azureMonitor.metricName === "AzureOpenAINormalizedTTFTInMS").description, /prompt token|normalized/i);
});

test("LAW retains live/fixture separation and adds run/workload/profile selection", () => {
  const vars = dashboard.templating.list.map(v => v.name);
  for (const name of ["deployment", "mode", "run", "workload", "profile"]) assert.ok(vars.includes(name));
  for (const panel of logs) {
    const query = panel.targets[0].azureLogAnalytics.query;
    for (const value of ['${mode:raw}', '${run:json}', '${workload:json}', '${profile:json}']) assert.ok(query.includes(value), `${panel.title}: ${value}`);
    assert.ok(query.includes('Properties["demo.mode"]'));
    assert.ok(!query.includes("AzureMetrics"));
  }
  for (const panel of native) assert.ok(!JSON.stringify(panel.targets).match(/\$\{(?:mode|run|workload|profile):/));
});

test("operational panels keep unknown usage and unknown costs nullable", () => {
  const operations = logs.slice(15);
  assert.equal(operations.length, 3);
  const combined = operations.map(p => p.targets[0].azureLogAnalytics.query).join("\n");
  for (const name of ["demo.workload", "demo.profile", "demo.worker_id", "UnknownUsage", "FinalUsageCoveragePct", "stream_cancelled", "stream_incomplete", "RunId"]) {
    assert.ok(combined.includes(name), name);
  }
  assert.match(combined, /KnownUsage==0, ?long\(null\)/);
  assert.match(combined, /PricedAttempts==0, ?real\(null\)/);
  assert.match(combined, /Known != true|coalesce\(Known, false\)/);
  assert.match(combined, /CompletedStreams==0, ?real\(null\)/);
});

test("scope guide is explicit about no data, PAYG and alert delivery evidence", () => {
  const content = dashboard.panels.find(p => p.type === "text").options.content;
  for (const phrase of ["No data is not zero", "N/A", "PAYG", "fixture", "ledger", "Action Group email", "7 log", "1 metric", "unverified"]) assert.ok(content.includes(phrase), phrase);
  assert.ok(!JSON.stringify(dashboard).includes('"noValue": "0"'));
  assert.ok(dashboard.links.some(l => l.title === "Azure Alerts"));
});

test("unavailable native metrics render explicit N/A instead of a query or zero", async () => {
  const { buildDashboard } = await import("../scripts/build-grafana.mjs");
  assert.equal(typeof buildDashboard, "function");
  const result = buildDashboard({
    workbook: await readJson("infra/workbook.json"),
    settings: await readJson("artifacts/settings.json"),
    models: (await readJson("config/models.json")).models,
    metricDefinitions: [],
  });
  assert.equal(result.panels.filter(p => p.targets?.some(t => t.queryType === "Azure Monitor")).length, 0);
  const unavailable = result.panels.filter(p => p.title.includes("N/A"));
  assert.equal(unavailable.length, 8);
  for (const panel of unavailable) {
    assert.equal(panel.type, "text");
    assert.ok(panel.options.content.includes("not returned by"));
    assert.equal(panel.targets?.length ?? 0, 0);
  }
});

test("verifier submits every native and LAW target using the GUID auth audience", async () => {
  const script = await readFile("scripts/Verify-Grafana.ps1", "utf8");
  assert.ok(script.includes("ce34e7e5-485f-4d76-964f-b3d2b16d1e4f"));
  for (const value of ["Azure Monitor", "Azure Log Analytics", "/api/ds/query", "$Panel.targets", "no_data", "nonNullValues"]) assert.ok(script.includes(value), value);
  assert.ok(!script.includes("$Panel.targets[0]"));
  assert.ok(!script.includes('Authorization = "******"'));
});

test("Grafana renders Workbook escapejson as its own quoted JSON variable", async () => {
  const { buildDashboard } = await import("../scripts/build-grafana.mjs");
  const workbook = await readJson("infra/workbook.json");
  for (const item of workbook.items) {
    if (item.content.query) item.content.query = item.content.query
      .replaceAll('tostring(dynamic({RunId:json}))', '"{RunId:escapejson}"');
  }
  const result = buildDashboard({
    workbook, settings: await readJson("artifacts/settings.json"),
    models: (await readJson("config/models.json")).models, metricDefinitions: [],
  });
  for (const panel of result.panels.filter(p => p.targets?.[0].queryType === "Azure Log Analytics")) {
    const query = panel.targets[0].azureLogAnalytics.query;
    assert.ok(query.includes("${run:json}"), panel.title);
    assert.ok(!query.includes("{RunId:escapejson}"), panel.title);
    assert.ok(!query.includes('"${run:json}"'), panel.title);
  }
});
