import { readFile, writeFile } from "node:fs/promises";

const models = JSON.parse(await readFile("config/models.json", "utf8")).models;
const prices = JSON.parse(await readFile("config/model-prices.json", "utf8"));
const priceRows = prices.map(p => `  "${p.model}", "${p.modelVersion}", "${p.deploymentSku}", ${p.inputPerMillion}, ${p.cachedInputPerMillion}, ${p.outputPerMillion}, ${p.maxPromptTokens}, datetime(${p.effectiveFrom}), datetime(${p.effectiveTo})`);
const preamble = `let PriceSnapshot = datatable(Model:string, Version:string, Sku:string, InputUsd:real, CachedUsd:real, OutputUsd:real, MaxPrompt:long, From:datetime, To:datetime)\n[\n${priceRows.join(",\n")}\n];\nlet RunFilter = tostring(dynamic({RunId:json}));\n`;
const base = `${preamble}AppDependencies
| where TimeGenerated {TimeRange}
| where Properties["telemetry.kind"] == "aoai.request"
| where tostring(Properties["demo.mode"]) == "{Mode}"
| extend Deployment=tostring(Properties["aoai.deployment"]), Model=tostring(Properties["gen_ai.request.model"]),
  Version=tostring(Properties["aoai.model_version"]), Sku=tostring(Properties["aoai.deployment_sku"]),
  RunId=tostring(Properties["demo.run_id"]), Outcome=tostring(Properties["aoai.outcome"]),
  Status=toint(Properties["aoai.status_code"]), Prompt=tolong(Properties["aoai.prompt_tokens"]),
  Completion=tolong(Properties["aoai.completion_tokens"]), Cached=tolong(Properties["aoai.cached_tokens"]),
  Known=tobool(Properties["aoai.usage_known"]), Annotated=tobool(Properties["aoai.filter_observed"]),
  RecordedCost=todouble(Properties["aoai.estimated_cost_usd"]), Streaming=tobool(Properties["aoai.streaming"]),
  TTFT=todouble(Properties["aoai.ttft_ms"]), Gap=todouble(Properties["aoai.inter_chunk_mean_ms"]),
  Completed=tobool(Properties["aoai.stream_completed"])
| where "{Deployment}" == "all" or Deployment == "{Deployment}"
| where "{Model}" == "all" or Model == "{Model}"
| where "{StreamType}" == "all" or tostring(Streaming) == "{StreamType}"
| where isempty(RunFilter) or RunId == RunFilter
| lookup kind=leftouter PriceSnapshot on Model, Version, Sku
| extend RetailRepriced=iff(Known and tostring(Properties["aoai.cost_reason"]) != "price_scope_unsupported" and isnotnull(InputUsd) and Prompt <= MaxPrompt and TimeGenerated >= From and TimeGenerated < To,
  ((Prompt-Cached)*InputUsd + Cached*CachedUsd + Completion*OutputUsd)/1000000.0, real(null))
| extend EstimatedUsd=coalesce(RecordedCost, RetailRepriced), PriceBasis=iff(isnotnull(RecordedCost), "recorded rate version", iff(isnotnull(RetailRepriced),"current Azure retail snapshot reprice","unknown"))`;
const items = [];
function text(name, markdown) { items.push({ type: 1, content: { json: markdown }, name }); }
function query(name, title, suffix, visualization = "table") {
  items.push({ type: 3, name, content: {
    version: "KqlItem/1.0", title, query: `${base}\n${suffix}`, size: 0, queryType: 0,
    resourceType: "microsoft.operationalinsights/workspaces", crossComponentResources: ["__WORKSPACE_RESOURCE_ID__"],
    timeContextFromParameter: "TimeRange", visualization,
  } });
}
text("intro", "# Azure OpenAI · Native Operations\nAzure Monitor Workbook · Streaming API · No AKS / No local dashboard\n\n기간·모델·live/fixture·Run UUID로 조회합니다. 비용은 Azure public retail 추정이며 invoice가 아닙니다. 과거 null 비용의 재계산은 별도 price basis로 표시합니다.");
items.push({ type: 9, name: "filters", content: { version: "KqlParameterItem/1.0", style: "pills",
  parameters: [
    { id: "1c8c6df8-07c3-44ea-99cd-bce835849405", version: "KqlParameterItem/1.0", name: "TimeRange", label: "기간", type: 4, isRequired: true, value: { durationMs: 86400000 },
      typeSettings: { selectableValues: [3600000, 21600000, 86400000, 604800000], allowCustom: true } },
    { id: "cf02ed28-81dd-4d8a-8524-20230787fb87", version: "KqlParameterItem/1.0", name: "Deployment", label: "모델 배포", type: 2, isRequired: true, value: "all",
      jsonData: JSON.stringify([{ value: "all", label: "모든 모델" }, ...models.map(m => ({ value: m.deployment, label: m.deployment }))]) },
    { id: "a22f1989-865d-4a94-88ad-4071f82b630a", version: "KqlParameterItem/1.0", name: "Mode", label: "데이터 종류", type: 2, isRequired: true, value: "live",
      jsonData: JSON.stringify([{ value: "live", label: "LIVE 실제 API" }, { value: "fixture", label: "FIXTURE 합성 시나리오" }]) },
    { id: "c9b4a5a1-c5ab-4b3c-a791-c8faea5fbb66", version: "KqlParameterItem/1.0", name: "RunId", label: "Run UUID (빈 값: 전체)", type: 1, value: "" },
    { id: "19fbc86b-24b0-4ad2-9410-8b898b8b9dda", version: "KqlParameterItem/1.0", name: "Model", label: "모델", type: 2, isRequired: true, value: "all",
      jsonData: JSON.stringify([{ value: "all", label: "모든 모델" }, ...models.map(m => ({ value: m.model, label: m.model }))]) },
    { id: "2edc995c-e2a9-4bfc-9d64-e906e4c9e30a", version: "KqlParameterItem/1.0", name: "StreamType", label: "Streaming", type: 2, isRequired: true, value: "all",
      jsonData: JSON.stringify([{ value: "all", label: "전체" }, { value: "true", label: "Streaming" }, { value: "false", label: "Non-streaming" }]) },
    { id: "2f7d946e-9310-40b3-a7f5-729d6223285d", version: "KqlParameterItem/1.0", name: "Subscription", label: "구독 (현재 배포 scope)", type: 2, isRequired: true, value: "__SUBSCRIPTION_ID__",
      jsonData: JSON.stringify([{ value: "__SUBSCRIPTION_ID__", label: "__SUBSCRIPTION_ID__" }]) },
    { id: "50c5c6a9-3ebd-4d39-bd76-8c8b058bd031", version: "KqlParameterItem/1.0", name: "OpenAIResource", label: "OpenAI 리소스 (현재 scope)", type: 2, isRequired: true, value: "__OPENAI_RESOURCE_ID__",
      jsonData: JSON.stringify([{ value: "__OPENAI_RESOURCE_ID__", label: "__OPENAI_RESOURCE_ID__" }]) },
  ], queryType: 0, resourceType: "microsoft.operationalinsights/workspaces" } });
text("overview-heading", "## 1 · 운영 현황\nFixture는 실제 서비스 실패나 청구가 아닙니다. Unknown usage/price를 0으로 대체하지 않습니다.");
query("kpis", "요청·사용량·비용 KPI", `| summarize Attempts=count(), Successes=countif(Outcome=="success"), InputTokens=sum(Prompt), OutputTokens=sum(Completion),
  KnownUsage=countif(Known), PricedAttempts=countif(isnotnull(EstimatedUsd)), EstimatedUsd=sum(EstimatedUsd)
| extend EstimatedUsd=iff(PricedAttempts==0,real(null),EstimatedUsd), UsageCoveragePct=iff(Attempts==0,real(null),100.0*KnownUsage/Attempts)`, "tiles");
query("requests-trend", "요청 추이 · 5분", '| summarize Attempts=count() by Time=bin(TimeGenerated,5m), Deployment\n| order by Time asc', "timechart");
query("outcomes", "결과별 호출 · 서버오류/429/필터차단 구분", '| summarize Attempts=count() by Outcome, Deployment', "barchart");
query("model-summary", "모델별 운영 비교", `| summarize Attempts=count(), Success=countif(Outcome=="success"), Errors=countif(Status>=500 or Outcome=="network_error"),
  Throttled=countif(Status==429), InputBlocks=countif(Outcome=="input_blocked"), OutputBlocks=countif(Outcome=="output_blocked"),
  P50DurationMs=percentile(DurationMs,50), P90DurationMs=percentile(DurationMs,90), P95DurationMs=percentile(DurationMs,95), P99DurationMs=percentile(DurationMs,99),
  UsageKnown=countif(Known), FilterAnnotated=countif(Annotated) by Deployment
| extend SuccessPct=100.0*Success/Attempts, UsageCoveragePct=100.0*UsageKnown/Attempts, AnnotationCoveragePct=100.0*FilterAnnotated/Attempts`);
text("streaming-heading", "## 2 · Streaming SLO\nTTFT는 첫 visible content까지의 client 시간입니다. Role-only chunk는 TTFT가 아닙니다. Chunk gap은 token TBT가 아닙니다.");
query("streaming", "TTFT·종료·취소·final usage", `| where Streaming
| summarize Streams=count(), Completed=countif(Completed), Cancelled=countif(Outcome=="stream_cancelled"),
  Incomplete=countif(Outcome=="stream_incomplete"), KnownUsage=countif(Known), TTFTObserved=countif(isnotnull(TTFT)),
  TTFTP50Ms=percentile(TTFT,50), TTFTP95Ms=percentile(TTFT,95), DurationP95Ms=percentile(DurationMs,95),
  InterChunkMeanMs=avg(Gap) by Deployment
| extend FinalUsageCoveragePct=100.0*KnownUsage/Streams`);
query("ttft-trend", "Streaming TTFT p95 / p99 · 모델별", '| where Streaming and isnotnull(TTFT)\n| summarize TTFTP95Ms=percentile(TTFT,95), TTFTP99Ms=percentile(TTFT,99) by Time=bin(TimeGenerated,5m), Deployment\n| order by Time asc', "timechart");
query("errors-trend", "HTTP 400/429/5xx · error / throttle rate", '| summarize Attempts=count(), HTTP400=countif(Status==400), HTTP429=countif(Status==429), HTTP5xx=countif(Status>=500), NetworkErrors=countif(Outcome=="network_error") by Time=bin(TimeGenerated,5m), Deployment\n| extend ThrottlePct=100.0*HTTP429/Attempts, ErrorPct=100.0*(HTTP5xx+NetworkErrors)/Attempts', "timechart");
query("tokens-per-request", "Tokenomics · 요청당 사용량/캐시 비율", '| summarize Requests=count(), KnownUsage=countif(Known), PromptTokens=sum(Prompt), CompletionTokens=sum(Completion), CachedTokens=sum(Cached) by Deployment\n| extend PromptTokensPerKnownRequest=iff(KnownUsage==0,real(null),1.0*PromptTokens/KnownUsage), OutputTokensPerKnownRequest=iff(KnownUsage==0,real(null),1.0*CompletionTokens/KnownUsage), CachePct=iff(PromptTokens==0,real(null),100.0*CachedTokens/PromptTokens)');
query("stream-outcomes", "취소·미완료·필터 실패", '| where Streaming\n| summarize Streams=count() by Outcome, Deployment', "barchart");
text("cost-heading", "## 3 · Azure 공식 가격 기반 추정\nEast US 2 / Global Standard / Short context / USD per 1M. 이 데모의 4,096 prompt token 제한 범위에만 적용합니다. Cache write 별도 meter, Flex/Priority/Long context/PTU는 제외합니다.\n\n미설정이었던 과거 telemetry는 현재 snapshot으로 재계산해 표시하되 기록된 원래 cost를 수정하지 않습니다.");
query("token-trend", "Input / Output / Cached token 추이", '| summarize Input=sum(Prompt), Output=sum(Completion), CachedInput=sum(Cached) by Time=bin(TimeGenerated,5m)\n| order by Time asc', "timechart");
query("cost-models", "모델별 token → USD", `| summarize Attempts=count(), KnownUsage=countif(Known), PricedAttempts=countif(isnotnull(EstimatedUsd)),
  PromptTokens=sum(Prompt), CachedTokens=sum(Cached), CompletionTokens=sum(Completion), EstimatedUsd=sum(EstimatedUsd),
  RecordedCostUsd=sum(RecordedCost), SnapshotRepriceUsd=sum(iff(isnull(RecordedCost),RetailRepriced,real(null))) by Deployment
| extend EstimatedUsd=iff(PricedAttempts==0,real(null),EstimatedUsd), PriceCoveragePct=100.0*PricedAttempts/Attempts`);
query("cost-trend", "추정 비용 USD · 청구 아님", '| where isnotnull(EstimatedUsd)\n| summarize EstimatedUsd=sum(EstimatedUsd) by Time=bin(TimeGenerated,5m), Deployment\n| order by Time asc', "timechart");
const ratePanel = { type: 3, name: "price-provenance", content: {
  version: "KqlItem/1.0", title: "가격 snapshot · 출처/유효기간/단위", query: `${preamble}PriceSnapshot
| project Model, Version, Sku, InputUsd, CachedUsd, OutputUsd, MaxPrompt, From, To
| extend Unit="USD per 1M", Source="https://azure.microsoft.com/en-us/pricing/details/azure-openai/"
// Selected time context: {TimeRange}`,
  size: 0, queryType: 0, resourceType: "microsoft.operationalinsights/workspaces",
  crossComponentResources: ["__WORKSPACE_RESOURCE_ID__"], timeContextFromParameter: "TimeRange", visualization: "table",
} };
items.push(ratePanel);
text("safety-heading", "## 4 · Guardrails\nHTTP 400 입력 차단과 HTTP 200 출력 차단을 구분합니다. Annotation 미반환은 safe가 아닙니다. Medium Prompt/Completion 정책과 실제 반환 coverage를 함께 봅니다.");
query("annotations", "필터 category / source / severity", '| mv-expand Filter=parse_json(tostring(Properties["aoai.filters"]))\n| summarize Observations=count(), Blocks=countif(tobool(Filter.filtered)) by Source=tostring(Filter.source), Category=tostring(Filter.category), Severity=tostring(Filter.severity)');
query("safety-events", "차단·filter service failure 요청", '| where Outcome in ("input_blocked","output_blocked","filter_unavailable")\n| project TimeGenerated, Deployment, Outcome, Status, RunId, OperationId, Annotated, UsageKnown=Known\n| order by TimeGenerated desc\n| take 100');
query("coverage", "Usage / pricing / annotation coverage", '| summarize Attempts=count(), UsageKnown=countif(Known), Priced=countif(isnotnull(EstimatedUsd)), Annotations=countif(Annotated) by Deployment\n| extend UnknownUsage=Attempts-UsageKnown, Unpriced=Attempts-Priced, MissingAnnotations=Attempts-Annotations');
text("ledger-heading", "## 5 · Request ledger & 수집 신뢰성\n원문/credential 미수집. 표는 최근 100행으로 제한합니다. 기간별 합계와 최신 run count를 혼동하지 마십시오.");
query("ledger", "최근 요청 100개 · recorded vs repriced cost", '| project TimeGenerated, Deployment, Outcome, Status, TTFT, DurationMs, Streaming, Completed, Prompt, Completion, Cached, EstimatedUsd, RecordedCost, PriceBasis, RunId, OperationId\n| order by TimeGenerated desc\n| take 100');
query("ingestion", "수집 지연 / 마지막 관측", '| extend LagSeconds=(ingestion_time()-TimeGenerated)/1s\n| summarize Attempts=count(), IngestionP95Seconds=percentile(LagSeconds,95), LastEvent=max(TimeGenerated) by Deployment');
items.push({ type: 3, name: "native-metrics", content: {
  version: "KqlItem/1.0", title: "서비스 native metrics · fixture와 합산 금지", query: `AzureMetrics
| where TimeGenerated {TimeRange}
| where _ResourceId =~ "__OPENAI_RESOURCE_ID__"
| where MetricName in ("ProcessedPromptTokens","GeneratedTokens","AzureOpenAIRequests")
| summarize Total=sum(Total) by Time=bin(TimeGenerated,5m), MetricName
| order by Time asc`, size: 0, queryType: 0, visualization: "timechart",
  resourceType: "microsoft.operationalinsights/workspaces", crossComponentResources: ["__WORKSPACE_RESOURCE_ID__"], timeContextFromParameter: "TimeRange",
} });
text("capacity-heading", "## 6 · Capacity / PAYG spillover\n현재 세 배포는 GlobalStandard PAYG입니다. PTU utilization / PTU→PAYG spillover는 **N/A**이며 0이나 token−quota 계산으로 만들지 않습니다. 실제 PTU를 도입하면 native UtilizationV2와 IsSpillover dimension을 조회합니다.\n\nAzure/agentops#343의 구획을 채택하되 legacy Latency/BlockedCalls/TotalCalls를 AOAI 전용 지표로 혼용하지 않습니다.");
text("alerts-heading", "## 7 · Azure native Alert / Governance\nAction Group 테스트 발송 성공과 실제 rule Fired/inbox 수신은 별도 증거입니다. Native metrics는 모든 서비스 호출을 포함하고 workbook의 mode/run filter와 scope가 다릅니다.");
for (const [name, title, kql] of [
  ["alert-config", "배포된 경고 · Resource Graph", `resources | where resourceGroup =~ "__RESOURCE_GROUP__" | where type =~ "microsoft.insights/scheduledqueryrules" | project name, Enabled=tobool(properties.enabled), Severity=toint(properties.severity), Window=tostring(properties.windowSize), Evaluation=tostring(properties.evaluationFrequency), Description=tostring(properties.description)`],
  ["receiver-config", "Action Group · 이메일 수신자 상태", `resources | where id =~ "__ACTION_GROUP_ID__" | mv-expand Receiver=properties.emailReceivers | project name, Email=tostring(Receiver.emailAddress), Status=tostring(Receiver.status), CommonSchema=tobool(Receiver.useCommonAlertSchema)`],
]) items.push({ type: 3, name, content: { version: "KqlItem/1.0", title, query: kql, queryType: 1,
  resourceType: "microsoft.resourcegraph/resources", crossComponentResources: ["__SUBSCRIPTION_ID__"], visualization: "table", size: 0 } });
text("governance", "### 운영 gate\n모델/version/SKU 승인 · Entra/RBAC · 원문 최소화 · Short context/가격 버전 · live/fixture 분리 · SLO baseline · Safety fail-open 정책 · 수집/청구 일별 대사\n\n원문 안전 평가, 자동 invoice reconciliation, private networking, 장기 부하 benchmark는 이 데모의 검증 범위 밖입니다.");
await writeFile("infra/workbook.json", JSON.stringify({ version: "Notebook/1.0", items,
  fallbackResourceIds: ["__WORKSPACE_RESOURCE_ID__"], isLocked: false }, null, 2) + "\n");

const parts = [];
function markdown(x, y, colSpan, rowSpan, title, content) {
  parts.push({ position: { x, y, colSpan, rowSpan }, metadata: {
    type: "Extension/HubsExtension/PartType/MarkdownPart", inputs: [],
    settings: { content: { settings: { title, content, markdownUri: null } } },
  } });
}
function metric(x, y, title, names, aggregationType) {
  parts.push({ position: { x, y, colSpan: 6, rowSpan: 4 }, metadata: {
    type: "Extension/Microsoft_Azure_Monitoring/PartType/MetricsChartPart",
    inputs: [{ name: "queryInputs", value: { timespan: { duration: "PT24H" }, id: "__OPENAI_RESOURCE_ID__", chartType: 0,
      metrics: names.map(name => ({ name, resourceId: "__OPENAI_RESOURCE_ID__", namespace: "Microsoft.CognitiveServices/accounts", aggregationType })) } }],
    settings: { content: { options: { chart: { title } } } },
  } });
}
markdown(0, 0, 12, 2, "AI Observability · Azure Native", "## Streaming API Operations\n**No AKS / No local app required** · Entra/RBAC · Azure Monitor Metrics / Log Analytics\n\n[상세 Workbook: 모델·기간·live/fixture·비용·가드레일](https://portal.azure.com/#@/resource__WORKBOOK_RESOURCE_ID__/workbook)");
metric(0, 2, "Azure OpenAI Requests", ["AzureOpenAIRequests"], 1);
metric(6, 2, "Input / Output Tokens", ["ProcessedPromptTokens", "GeneratedTokens"], 1);
metric(0, 6, "Service time to last byte (not client TTFT)", ["AzureOpenAITTLTInMS"], 4);
metric(6, 6, "Total inference tokens (do not add to prompt/output)", ["TokenTransaction"], 1);
markdown(0, 10, 6, 3, "価格 / Guardrails", prices.map(p => `* ${p.model}: Input $${p.inputPerMillion}, Cached $${p.cachedInputPerMillion}, Output $${p.outputPerMillion} / 1M`).join("\n") +
  "\n\nAzure retail / Global Standard / Short context / USD. Cache writes・Flex・Priority・Long contextは別 meter。\n\n[Azure公式価格](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)");
markdown(6, 10, 6, 3, "運用 / Notifications", "[Workbook 상세 분석](https://portal.azure.com/#@/resource__WORKBOOK_RESOURCE_ID__/workbook)\n\n[Log Analytics](https://portal.azure.com/#@/resource__WORKSPACE_RESOURCE_ID__/logs)\n\n[Action Group](https://portal.azure.com/#@/resource__ACTION_GROUP_ID__/overview)\n\nStreaming TTFT・usage coverage・차단 detail은 Workbook. 테스트 메일과 실제 Fired 이력을 구분.");
await writeFile("infra/dashboard.json", JSON.stringify({ lenses: [{ order: 0, parts }],
  metadata: { model: { timeRange: { value: { relative: { duration: 24, timeUnit: 1 } }, type: "MsPortalFx.Composition.Configuration.ValueTypes.TimeRange" } } } }, null, 2) + "\n");
console.log(`Built ${items.filter(i => i.type === 3).length} Workbook panels and ${parts.length} native Dashboard parts.`);
