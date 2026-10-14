import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractRateCard } from "../scripts/azure-prices.mjs";

const model = { model: "gpt-6-luna", modelVersion: "2026-09-22", deploymentSku: "GlobalStandard" };
const rows = [
  ["Inp", 0.1], ["Cd Inp", 0.01], ["Opt", 0.5], ["Cd Wr", 0.125],
].map(([kind, rate]) => ({
  skuName: `6-luna ShortCo ${kind} Std Gl`, meterName: `6-luna ShortCo ${kind} Std Gl 1M Tokens`,
  productName: "Azure OpenAI GPT6", armRegionName: "eastus2", unitOfMeasure: "1M",
  type: "Consumption", currencyCode: "USD", retailPrice: rate, effectiveStartDate: "2026-09-01T00:00:00Z",
  tierMinimumUnits: 0, meterId: `meter-${kind}`,
}));
test("exact Azure meter matching never confuses cached input/output/Flex/long context", () => {
  const card = extractRateCard([...rows,
    { ...rows[0], skuName: "6-luna LongCo Inp Std Gl", retailPrice: 0.2 },
    { ...rows[0], skuName: "6-luna ShortCo Inp PP Gl", retailPrice: 9 }
  ], model, "2026-10-14");
  assert.equal(card.inputPerMillion, 0.1);
  assert.equal(card.cachedInputPerMillion, 0.01);
  assert.equal(card.outputPerMillion, 0.5);
  assert.equal(card.cacheWritePerMillion, 0.125);
  assert.equal(card.status, "verified");
  assert.equal(card.maxPromptTokens, 4096);
});
test("missing, duplicate, wrong-region and wrong-unit meters fail explicitly", () => {
  for (const changed of [rows.slice(1), [...rows, rows[0]],
    rows.map(r => ({ ...r, armRegionName: "westus" })), rows.map(r => ({ ...r, unitOfMeasure: "1K" }))]) {
    assert.throws(() => extractRateCard(changed, model, "2026-10-14"), /meter/i);
  }
});
test("native entry points have no local-app dependency and workbook has real filters and charts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.scripts.dashboard, undefined);
  const w = JSON.parse(await readFile("infra/workbook.json", "utf8"));
  const params = w.items.find(i => i.type === 9).content.parameters;
  assert.deepEqual(params.map(p => p.name), ["TimeRange", "Deployment", "Mode", "RunId", "Model", "StreamType", "Subscription", "OpenAIResource"]);
  const panels = w.items.filter(i => i.type === 3);
  assert.ok(panels.length >= 15);
  for (const panel of panels.filter(i => i.content.queryType === 0)) {
    assert.ok(panel.content.query.includes("{TimeRange}"), panel.name);
  }
  assert.ok(panels.some(i => i.content.visualization === "timechart"));
  assert.ok(panels.some(i => i.content.visualization === "tiles"));
  const dashboard = JSON.parse(await readFile("infra/dashboard.json", "utf8"));
  assert.ok(dashboard.lenses[0].parts.filter(p => p.metadata.type.endsWith("MetricsChartPart")).length >= 3);
});
test("Workbook tile panels define tile settings that match columns projected by the query", async () => {
  const workbook = JSON.parse(await readFile("infra/workbook.json", "utf8"));
  const tiles = workbook.items.filter(i => i.content.visualization === "tiles");
  assert.ok(tiles.length >= 1);
  for (const panel of tiles) {
    const settings = panel.content.tileSettings;
    assert.ok(settings, `${panel.name}: tiles require tileSettings`);
    for (const slot of ["titleContent", "leftContent", "bottomContent"]) {
      const column = settings[slot]?.columnMatch;
      assert.ok(column, `${panel.name}: ${slot}`);
      assert.match(panel.content.query, new RegExp(`\\b${column}\\b`), `${panel.name}: column ${column} missing from query`);
    }
    assert.ok(/mv-expand|union|datatable/.test(panel.content.query), `${panel.name}: tiles need one row per KPI`);
  }
});
test("Workbook run filtering uses documented Portal escaping and a nonempty all default", async () => {
  const workbook = JSON.parse(await readFile("infra/workbook.json", "utf8"));
  const run = workbook.items.find(i => i.type === 9).content.parameters.find(p => p.name === "RunId");
  assert.equal(run.value, "all");
  for (const panel of workbook.items.filter(i => i.content.query?.includes("let RunFilter"))) {
    assert.ok(panel.content.query.includes('let RunFilter = "{RunId:escapejson}";'), panel.name);
    if (panel.content.query.includes("AppDependencies")) {
      assert.ok(panel.content.query.includes('RunFilter == "all"'), panel.name);
    }
    assert.ok(!panel.content.query.includes("{RunId:json}"), panel.name);
  }
});
