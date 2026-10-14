import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const namespace = "Microsoft.CognitiveServices/accounts";
const selected = ["kpis", "requests-trend", "model-summary", "token-trend", "tokens-per-request", "streaming",
  "ttft-trend", "errors-trend", "cost-models", "cost-trend", "annotations", "safety-events", "coverage", "ledger", "ingestion"];
const scopePreamble = `let WorkloadFilter = tostring(dynamic(\${workload:json}));
let ProfileFilter = tostring(dynamic(\${profile:json}));
`;
const scope = `| extend Workload=iff(isempty(tostring(Properties["demo.workload"])), "ad-hoc", tostring(Properties["demo.workload"])),
  Profile=iff(isempty(tostring(Properties["demo.profile"])), "unspecified", tostring(Properties["demo.profile"])),
  Worker=iff(isempty(tostring(Properties["demo.worker_id"])), "unassigned", tostring(Properties["demo.worker_id"]))
| where WorkloadFilter == "all" or Workload == WorkloadFilter
| where ProfileFilter == "all" or Profile == ProfileFilter`;
const nativeSpecs = [
  ["Service requests · status × deployment", "AzureOpenAIRequests", "Total", "short", ["StatusCode"],
    "Service request totals split by StatusCode and deployment. Includes real calls outside the demo. HTTP status is not a complete content-safety outcome."],
  ["Service requests · deployment", "AzureOpenAIRequests", "Total", "short", [],
    "Service request totals by deployment; separate from the client attempt ledger, not an additional count to sum."],
  ["Service processed prompt tokens", "ProcessedPromptTokens", "Total", "short", [],
    "Service input token meter. Not client ledger input totals; do not sum the two or infer invoice cost from this meter."],
  ["Service generated completion tokens", "GeneratedTokens", "Total", "short", [],
    "Service output token meter. Pair with latency for context, not with input or TokenTransaction as an extra usage total."],
  ["Service token transactions", "TokenTransaction", "Total", "short", [],
    "Independent service token transaction meter. Do not add it to input + output or derive recorded client cost from it."],
  ["Service last-byte latency · Average", "AzureOpenAITTLTInMS", "Average", "ms", [],
    "Gateway Time to Last Byte, Average only; not client duration or a percentile. Pair with generated token volume. Availability depends on deployment/cloud/tier and emitted samples."],
  ["Normalized first-byte latency · Average · availability varies", "AzureOpenAINormalizedTTFTInMS", "Average", "ms", [],
    "First-byte latency normalized by prompt token count; not absolute client-visible-content TTFT. Definition advertised here, but availability depends on deployment/cloud/tier and samples."],
  ["Normalized between-token latency · Average · availability varies", "AzureOpenAINormalizedTBTInMS", "Average", "ms", [],
    "Service normalized between-token latency; not the application's inter-chunk gap. Definition advertised here, but availability depends on deployment/cloud/tier and samples."],
];

const custom = (name, values, value) => ({
  name, type: "custom", query: values.join(","), multi: false, includeAll: false,
  options: values.map(v => ({ text: v, value: v, selected: v === value })), current: { text: value, value },
});
const textbox = (name, label, value) => ({ name, label, type: "textbox", query: value, current: { text: value, value }, options: [] });

function renderLogQuery(query) {
  return scopePreamble + query.replaceAll("TimeGenerated {TimeRange}", "$__timeFilter(TimeGenerated)")
    .replaceAll('"{RunId:escapejson}"', "${run:json}")
    .replaceAll("{RunId:json}", "${run:json}").replaceAll("{Deployment}", "${deployment:raw}")
    .replace('"${deployment:raw}" == "all"', '"${deployment:raw}" in ("all", "*")')
    .replaceAll("{Model}", "all").replaceAll("{StreamType}", "all").replaceAll("{Mode}", "${mode:raw}")
    .replace('| where Properties["telemetry.kind"] == "aoai.request"',
      '| where Properties["telemetry.kind"] == "aoai.request"\n' + scope);
}

export function buildDashboard({ workbook, settings, models, metricDefinitions, datasourceUid = "aoai-azure-monitor" }) {
  if (!Array.isArray(metricDefinitions)) throw new Error("An observed metric definition list is required (never assume support).");
  const datasource = { type: "grafana-azure-monitor-datasource", uid: datasourceUid };
  const portal = `https://portal.azure.com/#@/resource${settings.openAiResourceId}`;
  const links = [
    { title: "Azure Workbook", url: `https://portal.azure.com/#@/resource${settings.workbookResourceId}/workbook`, targetBlank: true },
    { title: "Azure Metrics", url: `${portal}/metrics`, targetBlank: true },
    { title: "Azure Alerts", url: `${portal}/alerts`, targetBlank: true },
  ];
  const fieldConfig = unit => ({ defaults: {
    ...(unit ? { unit } : {}), links, custom: { lineWidth: 2, fillOpacity: 8, spanNulls: false },
  }, overrides: [] });
  const position = index => ({ x: index % 2 * 12, y: Math.floor(index / 2) * 8, w: 12, h: 8 });
  const logPanel = (id, title, query, timeSeries, gridPos) => ({
    id, title, type: timeSeries ? "timeseries" : "table", gridPos, datasource,
    description: "Client ledger / LAW. Applies live/fixture, deployment, run, workload and profile filters. Null usage/cost is unknown, not zero. Client TTFT is first visible content, not service first byte.",
    targets: [{ refId: "A", queryType: "Azure Log Analytics", datasource,
      azureLogAnalytics: { query: renderLogQuery(query), resources: [settings.workspaceResourceId],
        resultFormat: timeSeries ? "time_series" : "table" } }],
    fieldConfig: fieldConfig(),
    options: timeSeries ? { legend: { displayMode: "table", placement: "bottom", calcs: ["lastNotNull"] }, tooltip: { mode: "multi" } } : { showHeader: true },
  });
  const panels = selected.map((name, index) => {
    const source = workbook.items.find(i => i.name === name)?.content;
    if (!source?.query) throw new Error(`Workbook query missing: ${name}`);
    return logPanel(index + 1, source.title, source.query, source.visualization === "timechart", position(index));
  });
  const textPanel = (id, title, content, gridPos) => ({
    id, title, type: "text", gridPos, options: { mode: "markdown", content },
  });
  panels.push(textPanel(16, "Scope, availability & operations guide", `## Native service ≠ client ledger
**No data is not zero.** Native Azure Monitor panels always show real service traffic. They ignore fixture/live mode, run, workload and profile; the deployment filter is applied only where the observed definition supports ModelDeploymentName. Do not sum native service metrics with LAW or sum TokenTransaction with prompt/output meters.

Definitions are discovered with list-definitions at generation. A supported definition is not proof of populated samples: cloud, deployment and service tier support apply. Missing definitions show **N/A**; empty samples remain no data (no fake zero fallback). PTU utilization / PTU→PAYG spillover are **N/A for these GlobalStandard PAYG deployments**, even when the account advertises PTU definitions.

Native last-byte and normalized latency use **Average**, not p95/p99. LAW TTFT is first **visible content** at the client; service first-byte, normalized first-byte and chunk-gap/TBT are different semantics.

**Azure Monitor alarms:** 7 log + 1 metric rules → Action Group email recipient (configured at deployment). Rule configuration is observed; actual Fired event and inbox delivery are **unverified** here. No SMTP/secret setup and no email test sent by this workflow. Use the Workbook / Metrics / Alerts links.

For continuous low load: segment profile/run/worker, inspect cancellations and final usage coverage, wait for ingestion, and use minimum sample gates before paging on percentiles. Long output makes last-byte time longer; sustained service regressions need token/profile context, not a single pathological request. See \`docs/grafana-operations.md\` for thresholds and anti-flood guidance.`,
  { x: 0, y: 64, w: 24, h: 9 }));

  for (const [index, [title, metricName, aggregation, unit, split, description]] of nativeSpecs.entries()) {
    const definition = metricDefinitions.find(d => (d.name?.value ?? d.name) === metricName);
    const dimensions = (definition?.dimensions ?? []).map(d => typeof d === "string" ? d : d.value ?? d.name?.value);
    const supported = definition?.supportedAggregationTypes ?? [definition?.primaryAggregationType];
    const gridPos = { ...position(index), y: 73 + Math.floor(index / 2) * 8 };
    if (!definition || !supported.includes(aggregation) || split.some(d => !dimensions.includes(d))) {
      panels.push(textPanel(17 + index, `${title} · N/A`,
        `**N/A** — ${metricName} or its required aggregation/dimension was not returned by this resource's list-definitions. No query or zero substitute was generated. Cloud/deployment/tier support applies.`, gridPos));
      continue;
    }
    const deploymentSupported = dimensions.includes("ModelDeploymentName");
    const dimensionFilters = [
      ...(deploymentSupported ? [{ dimension: "ModelDeploymentName", operator: "eq", filters: ["${deployment:raw}"] }] : []),
      ...split.map(dimension => ({ dimension, operator: "eq", filters: ["*"] })),
    ];
    panels.push({
      id: 17 + index, title, type: "timeseries", datasource, gridPos,
      description: `${description} Native always real; ignores mode, run, workload and profile filters. ${deploymentSupported ? "Deployment filter supported." : "Deployment filter N/A: not present in definition."} No data is not zero.`,
      targets: [{ refId: "A", datasource, queryType: "Azure Monitor", subscription: settings.subscriptionId,
        azureMonitor: {
          metricNamespace: namespace, metricName, aggregation, timeGrain: "PT5M", top: "100",
          resources: [{ subscription: settings.subscriptionId, resourceGroup: settings.resourceGroupName,
            resourceName: settings.openAiAccountName, metricNamespace: namespace, region: settings.location }],
          dimensionFilters, alias: `${metricName} · {{ ModelDeploymentName }}${split.length ? " · {{ StatusCode }}" : ""}`,
        } }],
      fieldConfig: fieldConfig(unit),
      options: { legend: { displayMode: "table", placement: "bottom", calcs: ["lastNotNull"] }, tooltip: { mode: "multi" } },
    });
  }
  const base = workbook.items.find(i => i.name === "kpis").content.query.split("\n| summarize")[0];
  const operations = [
    ["Workload / profile / run / worker traffic", `${base}
| summarize Attempts=count(), Successes=countif(Outcome=="success"), KnownUsage=countif(Known==true),
  PricedAttempts=countif(Known==true and isnotnull(EstimatedUsd)),
  InputTokens=sum(iff(Known==true,Prompt,long(null))), OutputTokens=sum(iff(Known==true,Completion,long(null))),
  EstimatedUsd=sum(iff(Known==true,EstimatedUsd,real(null))), LastEvent=max(TimeGenerated)
  by Workload, Profile, RunId, Worker, Deployment
| extend UnknownUsage=Attempts-KnownUsage, InputTokens=iff(KnownUsage==0,long(null),InputTokens),
  OutputTokens=iff(KnownUsage==0,long(null),OutputTokens), EstimatedUsd=iff(PricedAttempts==0,real(null),EstimatedUsd)
| order by LastEvent desc
| take 100`, false],
    ["Final usage & cost coverage · unknown stays null", `${base}
| summarize Attempts=count(), KnownUsage=countif(Known==true), UnknownUsage=countif(coalesce(Known, false)==false),
  PricedAttempts=countif(Known==true and isnotnull(EstimatedUsd)), Streams=countif(Streaming==true),
  StreamsWithUsage=countif(Streaming==true and Known==true), CompletedStreams=countif(Streaming==true and Completed==true),
  CompletedWithUsage=countif(Streaming==true and Completed==true and Known==true),
  InputTokens=sum(iff(Known==true,Prompt,long(null))), OutputTokens=sum(iff(Known==true,Completion,long(null))),
  EstimatedUsd=sum(iff(Known==true,EstimatedUsd,real(null))) by Workload, Profile, Deployment
| extend UnpricedAttempts=Attempts-PricedAttempts,
  InputTokens=iff(KnownUsage==0,long(null),InputTokens), OutputTokens=iff(KnownUsage==0,long(null),OutputTokens),
  EstimatedUsd=iff(PricedAttempts==0,real(null),EstimatedUsd),
  FinalUsageCoveragePct=iff(Streams==0,real(null),100.0*StreamsWithUsage/Streams),
  CompletedUsageCoveragePct=iff(CompletedStreams==0,real(null),100.0*CompletedWithUsage/CompletedStreams)`, false],
    ["Continuous-load outcomes & client TTFT · profile context", `${base}
| where Streaming==true
| summarize Streams=count(), Cancelled=countif(Outcome=="stream_cancelled"), Incomplete=countif(Outcome=="stream_incomplete"),
  CompletedStreams=countif(Completed==true), FinalUsageObserved=countif(Known==true),
  TTFTSamples=countif(isnotnull(TTFT)), TTFTP95Ms=percentile(TTFT,95), DurationP95Ms=percentile(DurationMs,95)
  by Time=bin(TimeGenerated,5m), Workload, Profile, Deployment
| extend FinalUsageCoveragePct=iff(Streams==0,real(null),100.0*FinalUsageObserved/Streams)
| order by Time asc`, true],
  ];
  for (const [index, [title, query, timeSeries]] of operations.entries()) {
    panels.push(logPanel(25 + index, title, query, timeSeries, { ...position(index), y: 105 + Math.floor(index / 2) * 8 }));
  }
  return {
    uid: "aoai-streaming-hybrid", title: "AI Observability · Streaming Hybrid", schemaVersion: 39, version: 1,
    tags: ["azure-openai", "streaming", "governance", "no-aks"], timezone: "browser", refresh: "1m",
    time: { from: "now-24h", to: "now" },
    templating: { list: [
      { ...custom("deployment", ["all", ...models.map(m => m.deployment)], "all"),
        query: ["all : *", ...models.map(m => m.deployment)].join(","),
        current: { text: "all", value: "*" },
        options: [{ text: "all", value: "*", selected: true }, ...models.map(m => ({ text: m.deployment, value: m.deployment, selected: false }))] },
      custom("mode", ["live", "fixture"], "live"),
      textbox("run", "Run UUID (blank: all LAW)", ""), custom("workload", ["all", "continuous-load", "ad-hoc"], "all"),
      textbox("profile", "Profile (all or exact LAW value)", "all"),
    ] },
    links: [...links.map(link => ({ ...link, type: "link" })),
      { title: "Azure pricing", url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/", type: "link", targetBlank: true }],
    panels,
    description: "18 LAW ledger queries + 8 native Azure Monitor metric panels + scope guide when supported. Native always real traffic, ignores LAW mode/run/profile; never sum with ledger. Average service latency is not client p95. Unknown costs/usage stay null; no data is not zero. PTU/spillover N/A for PAYG.",
  };
}

async function main() {
  const settings = JSON.parse(await readFile("artifacts/settings.json", "utf8"));
  if (!/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[\w.-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w.-]+$/i.test(settings.openAiResourceId)) {
    throw new Error("Expected an Azure OpenAI account ARM resource ID.");
  }
  const args = ["monitor", "metrics", "list-definitions", "--resource", settings.openAiResourceId, "--only-show-errors", "-o", "json"];
  const output = process.platform === "win32"
    ? execFileSync("pwsh", ["-NoProfile", "-Command", `& az ${args.map(a => `'${a}'`).join(" ")}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`], { encoding: "utf8", timeout: 120000 })
    : execFileSync("az", args, { encoding: "utf8", timeout: 120000 });
  const datasourceUid = process.env.GRAFANA_DATASOURCE_UID ?? "aoai-azure-monitor";
  const dashboard = buildDashboard({
    workbook: JSON.parse(await readFile("infra/workbook.json", "utf8")), settings,
    models: JSON.parse(await readFile("config/models.json", "utf8")).models,
    metricDefinitions: JSON.parse(output), datasourceUid,
  });
  await writeFile("infra/grafana-dashboard.json", JSON.stringify(dashboard, null, 2) + "\n");
  await writeFile("infra/grafana-datasource.json", JSON.stringify({
    uid: datasourceUid, name: "AOAI Azure Monitor", type: "grafana-azure-monitor-datasource", access: "proxy",
    jsonData: { azureAuthType: "msi", cloudName: "azuremonitor", subscriptionId: settings.subscriptionId },
  }, null, 2) + "\n");
  console.log(`Generated ${dashboard.panels.length} Grafana panels from observed definitions; datasource ${datasourceUid}. Workbook unchanged.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
