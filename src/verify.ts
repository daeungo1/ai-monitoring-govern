import { readFile, writeFile, mkdir } from "node:fs/promises";
import { AzureCliCredential } from "@azure/identity";
import { record } from "./accounting.js";
import { loadModels, selectModels } from "./models.js";
import { fixtures } from "./fixtures.js";
import { readdir } from "node:fs/promises";
import { renderWorkbookQuery } from "./native-monitoring.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing verification setting: ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const workspaceId = required("LOG_ANALYTICS_WORKSPACE_ID");
  const liveRun = required("VERIFY_LIVE_RUN_ID");
  const replayRun = required("VERIFY_REPLAY_RUN_ID");
  for (const id of [workspaceId, liveRun, replayRun]) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("Verification IDs must be UUIDs.");
  }
  const models = selectModels(await loadModels(process.env.MODEL_CONFIG_FILE ?? "config/models.json"),
    process.env.DEMO_DEPLOYMENTS);
  const countPerModel = Number(process.env.VERIFY_COUNT_PER_MODEL ?? 1);
  const expectedLive = models.length * countPerModel;
  const expectedFixture = models.length * fixtures.length;
  if (!Number.isInteger(countPerModel) || countPerModel < 1 || countPerModel > 20) {
    throw new Error("VERIFY_COUNT_PER_MODEL must be 1..20.");
  }
  const credential = new AzureCliCredential({ processTimeoutInMs: 30000 });
  console.log("Acquiring one Log Analytics token for the verification batch.");
  const logToken = await credential.getToken("https://api.loganalytics.io/.default");
  let armToken: Awaited<ReturnType<AzureCliCredential["getToken"]>> | undefined;
  async function query(kql: string): Promise<unknown[][]> {
    const response = await fetch(`https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`, {
      method: "POST", headers: { Authorization: `Bearer ${logToken.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: kql, timespan: "PT24H" }), signal: AbortSignal.timeout(30000),
    });
    const body = record(await response.json());
    if (!response.ok || body.error) {
      throw new Error(`Log Analytics query failed (HTTP ${response.status}); check RBAC, table availability and KQL.`);
    }
    const table = Array.isArray(body.tables) ? record(body.tables[0]) : {};
    if (!Array.isArray(table.rows) || !table.rows.every(row => Array.isArray(row))) {
      throw new Error("Unexpected Log Analytics response shape.");
    }
    return table.rows as unknown[][];
  }

  const requests = `AppDependencies
| where TimeGenerated > ago(24h)
| where Properties["telemetry.kind"] == "aoai.request"
| where tostring(Properties["demo.run_id"]) in ("${liveRun}", "${replayRun}")`;
  let rows: unknown[][] = [];
  for (let attempt = 0; attempt < 16; attempt++) {
    rows = await query(`${requests}
| summarize Attempts=count() by Run=tostring(Properties["demo.run_id"]), Mode=tostring(Properties["demo.mode"]),
  Outcome=tostring(Properties["aoai.outcome"])`);
    const live = rows.filter(r => r[0] === liveRun && r[1] === "live")
      .reduce((sum, r) => sum + Number(r[3]), 0);
    const replay = rows.filter(r => r[0] === replayRun && r[1] === "fixture")
      .reduce((sum, r) => sum + Number(r[3]), 0);
    if (live === expectedLive && replay === expectedFixture) break;
    if (attempt === 15) throw new Error(`Ingestion evidence incomplete: live=${live}, fixture=${replay}.`);
    console.log(`Awaiting ingestion: live=${live}/${expectedLive}, fixture=${replay}/${expectedFixture}.`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  for (const outcome of ["input_blocked", "output_blocked", "throttled", "server_error", "filter_unavailable", "stream_cancelled", "stream_incomplete"]) {
    if (!rows.some(r => r[0] === replayRun && r[2] === outcome && r[3] === models.length)) {
      throw new Error(`Fixture evidence missing or duplicated: ${outcome}.`);
    }
  }
  if (!rows.some(r => r[0] === liveRun && r[2] === "success" && r[3] === expectedLive)) {
    throw new Error("Live API success count does not match expected count.");
  }
  const accounting = await query(`${requests}
| summarize Known=countif(tobool(Properties["aoai.usage_known"])), Unknown=countif(tobool(Properties["aoai.usage_known"]) == false),
  IncorrectZero=countif(tobool(Properties["aoai.usage_known"]) == false and isnotempty(Properties["aoai.estimated_cost_usd"])),
  Cost=sum(todouble(Properties["aoai.estimated_cost_usd"])),
  Priced=countif(tobool(Properties["aoai.cost_known"])) by Mode=tostring(Properties["demo.mode"])
| extend Cost=iff(Priced == 0, real(null), Cost)`);
  if (!accounting.some(r => r[0] === "live" && r[1] === expectedLive && r[2] === 0 && r[3] === 0)
    || !accounting.some(r => r[0] === "fixture" && r[1] === 3 * models.length && r[2] === (fixtures.length - 3) * models.length && r[3] === 0)) {
    throw new Error("Unknown-cost handling or live accounting coverage failed.");
  }
  const perModel = await query(`${requests}
| where tostring(Properties["demo.run_id"]) == "${liveRun}"
| summarize Attempts=count(), Successes=countif(Properties["aoai.outcome"] == "success")
  by Deployment=tostring(Properties["aoai.deployment"])`);
  if (perModel.length !== models.length || models.some(model => !perModel.some(row =>
    row[0] === model.deployment && row[1] === countPerModel && row[2] === countPerModel))) {
    throw new Error("Per-model live success verification failed.");
  }
  const streaming = await query(`${requests}
| where tostring(Properties["demo.run_id"]) == "${liveRun}"
| summarize Streams=countif(tobool(Properties["aoai.streaming"])),
  Completed=countif(tobool(Properties["aoai.stream_completed"])),
  TTFTObserved=countif(isnotempty(Properties["aoai.ttft_ms"])), Usage=countif(tobool(Properties["aoai.usage_known"]))`);
  if (streaming[0]?.some(value => value !== expectedLive)) throw new Error("Streaming completion, TTFT or final usage verification failed.");
  const privacy = await query(`${requests}
| extend Forbidden=bag_has_key(Properties,"prompt") or bag_has_key(Properties,"response")
  or bag_has_key(Properties,"gen_ai.prompt") or bag_has_key(Properties,"gen_ai.completion")
| summarize ForbiddenRows=countif(Forbidden)`);
  if (privacy[0]?.[0] !== 0) throw new Error("Forbidden raw-content telemetry keys detected.");
  const workbook = record(JSON.parse(await readFile("infra/workbook.json", "utf8")));
  if (!Array.isArray(workbook.items)) throw new Error("Invalid workbook items.");
  const checkedQueries: string[] = [];
  const settings = record(JSON.parse(await readFile("artifacts/settings.json", "utf8")));
  const nativeEvidence: Record<string, unknown> = {};
  for (const item of workbook.items) {
    const entry = record(item);
    const content = record(entry.content);
    if (typeof content.query !== "string") continue;
    const rendered = renderWorkbookQuery(content.query,
      { hours: 24, deployment: "all", mode: "live", runId: "" }, settings);
    if (content.queryType === 1) {
      armToken ??= await credential.getToken("https://management.azure.com/.default");
      const response = await fetch("https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01", {
        method: "POST", headers: { Authorization: `Bearer ${armToken.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptions: [settings.subscriptionId], query: rendered }),
        signal: AbortSignal.timeout(30000),
      });
      const graph = record(await response.json());
      if (!response.ok || graph.error) throw new Error(`Native Resource Graph panel failed: ${entry.name}.`);
      nativeEvidence[String(entry.name)] = graph.data;
    } else {
      const result = await query(rendered);
      nativeEvidence[String(entry.name)] = { rows: result.length, sample: result.slice(0, 5) };
    }
    checkedQueries.push(String(entry.name));
    console.log(`Verified native panel: ${entry.name}`);
  }
  const costPanel = workbook.items.find(item => record(item).name === "cost-models");
  const costQuery = record(record(costPanel).content).query;
  if (typeof costQuery !== "string") throw new Error("Native cost comparison panel missing.");
  const filteredCosts = await query(renderWorkbookQuery(costQuery,
    { hours: 24, deployment: models[0]?.deployment ?? "all", mode: "live", runId: liveRun }, settings));
  if (filteredCosts.length !== 1) throw new Error("Native model/run filter validation failed.");
  const checkedAlertQueries: string[] = [];
  for (const file of await readdir("artifacts")) {
    if (!file.endsWith(".kql") || !file.startsWith("aoaimon")) continue;
    await query(await readFile(`artifacts/${file}`, "utf8"));
    checkedAlertQueries.push(file);
  }
  const checkedOperationsQueries: string[] = [];
  for (const file of await readdir("queries")) {
    if (!file.endsWith(".kql")) continue;
    await query(await readFile(`queries/${file}`, "utf8"));
    checkedOperationsQueries.push(file);
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/azure-verification.json", JSON.stringify({
    verifiedAt: new Date().toISOString(), liveRun, replayRun, outcomes: rows, accounting, perModel, streaming,
    forbiddenRows: privacy[0]?.[0], checkedWorkbookQueries: checkedQueries, checkedAlertQueries, checkedOperationsQueries,
    nativeEvidence, filteredCosts,
    caveats: ["Safety blocks are fixtures, not live harmful requests.", "Illustrative costs are not invoice reconciliation.",
      "Alert query/config checks do not prove email delivery or alert firing.", "Native telemetry is verified separately."],
  }, null, 2));
  console.log(JSON.stringify({ result: "passed", liveRun, replayRun, accounting, checkedWorkbookQueries: checkedQueries }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed.");
  process.exitCode = 1;
});
