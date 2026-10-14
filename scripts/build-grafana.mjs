import { readFile, writeFile } from "node:fs/promises";
const workbook = JSON.parse(await readFile("infra/workbook.json", "utf8"));
const settings = JSON.parse(await readFile("artifacts/settings.json", "utf8"));
const datasourceUid = process.env.GRAFANA_DATASOURCE_UID ?? "aoai-azure-monitor";
const selected = ["kpis", "requests-trend", "model-summary", "token-trend", "tokens-per-request", "streaming",
  "ttft-trend", "errors-trend", "cost-models", "cost-trend", "annotations", "safety-events", "coverage", "ledger", "ingestion"];
const panels = selected.map((name, index) => {
  const source = workbook.items.find(i => i.name === name).content;
  let query = source.query.replaceAll("TimeGenerated {TimeRange}", "$__timeFilter(TimeGenerated)")
    .replaceAll("{RunId:json}", '""').replaceAll("{Deployment}", "${deployment:raw}")
    .replaceAll("{Model}", "all").replaceAll("{StreamType}", "all").replaceAll("{Mode}", "${mode:raw}");
  return {
    id: index + 1, title: source.title,
    type: source.visualization === "timechart" ? "timeseries" : source.visualization === "tiles" ? "table" : "table",
    gridPos: { x: index % 2 * 12, y: Math.floor(index / 2) * 8, w: 12, h: 8 },
    datasource: { type: "grafana-azure-monitor-datasource", uid: datasourceUid },
    targets: [{ refId: "A", queryType: "Azure Log Analytics",
      datasource: { type: "grafana-azure-monitor-datasource", uid: datasourceUid },
      azureLogAnalytics: { query, resources: [settings.workspaceResourceId],
        resultFormat: source.visualization === "timechart" ? "time_series" : "table" },
    }],
    fieldConfig: { defaults: { custom: { lineWidth: 2, fillOpacity: 8 } }, overrides: [] },
    options: source.visualization === "timechart" ? { legend: { displayMode: "table", placement: "bottom", calcs: ["lastNotNull"] }, tooltip: { mode: "multi" } } : { showHeader: true },
  };
});
const custom = (name, values, value) => ({ name, type: "custom", query: values.join(","), multi: false,
  options: values.map(v => ({ text: v, value: v, selected: v === value })), current: { text: value, value }, includeAll: false });
const dashboard = {
  uid: "aoai-streaming-hybrid", title: "AI Observability · Streaming Hybrid", schemaVersion: 39, version: 1,
  tags: ["azure-openai", "streaming", "governance", "no-aks"], timezone: "browser", refresh: "1m",
  time: { from: "now-24h", to: "now" },
  templating: { list: [
    custom("deployment", ["all", ...JSON.parse(await readFile("config/models.json", "utf8")).models.map(m => m.deployment)], "all"),
    custom("mode", ["live", "fixture"], "live"),
  ] },
  links: [
    { title: "Azure Workbook", url: `https://portal.azure.com/#@/resource${settings.workbookResourceId}/workbook`, type: "link", targetBlank: true },
    { title: "Azure pricing", url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/", type: "link", targetBlank: true },
  ],
  panels,
  description: "Actual Azure Monitor LAW data. No agents or AKS. Fixture is not incident/billing. Retail reprice is separate from recorded ledger/invoice. PTU/spillover N/A for PAYG. Chunk gap is not token TBT.",
};
await writeFile("infra/grafana-dashboard.json", JSON.stringify(dashboard, null, 2) + "\n");
await writeFile("infra/grafana-datasource.json", JSON.stringify({
  uid: datasourceUid, name: "AOAI Azure Monitor", type: "grafana-azure-monitor-datasource", access: "proxy",
  jsonData: { azureAuthType: "msi", cloudName: "azuremonitor", subscriptionId: settings.subscriptionId },
}, null, 2) + "\n");
console.log(`Generated ${panels.length} Managed Grafana panels; datasource ${datasourceUid}.`);
