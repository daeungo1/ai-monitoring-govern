import { readFile, writeFile } from "node:fs/promises";
import { record } from "./accounting.js";
import { demoAlertPayload } from "./demo-scenarios.js";

async function main(): Promise<void> {
  const settings = record(JSON.parse(await readFile("artifacts/settings.json", "utf8")));
  const state = record(JSON.parse(await readFile("artifacts/loadtest/status.json", "utf8")));
  function setting(name: string): string {
    const value = settings[name];
    if (typeof value !== "string" || !value) throw new Error(`Missing demo alert setting: ${name}`);
    return value;
  }
  if (typeof state.workerId !== "string") throw new Error("Start a demo worker before configuring its alerts.");
  const account = setting("openAiAccountName");
  if (!/^[a-zA-Z\d-]{1,64}$/.test(account)) throw new Error("Invalid demo account name.");
  const root = `/subscriptions/${setting("subscriptionId")}/resourceGroups/${setting("resourceGroupName")}`;
  const rules = [];
  for (const kind of ["guardrail", "throttle", "budget"] as const) {
    const payload = demoAlertPayload(kind, state.workerId, {
      location: setting("location"), workspaceResourceId: setting("workspaceResourceId"),
      actionGroupId: setting("actionGroupId"),
    });
    const name = `${account}-demo-${kind}`;
    const path = `artifacts/loadtest/alert-${kind}.json`;
    await writeFile(path, JSON.stringify(payload, null, 2));
    rules.push({ name, id: `${root}/providers/Microsoft.Insights/scheduledQueryRules/${name}`, path, kind });
  }
  console.log(JSON.stringify({ workerId: state.workerId, rules }));
}
main().catch(() => { console.error("Cannot generate demo alert payloads. Check sanitized worker/settings files."); process.exitCode = 1; });
