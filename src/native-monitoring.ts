import { record } from "./accounting.js";

export interface WorkbookSelection {
  hours: number;
  deployment: string;
  mode: "live" | "fixture";
  runId: string;
}
export function renderWorkbookQuery(query: string, selection: WorkbookSelection, settings: Record<string, unknown>): string {
  if (!Number.isInteger(selection.hours) || selection.hours < 1 || selection.hours > 168
    || !/^(all|[a-zA-Z\d._-]{1,64})$/.test(selection.deployment)
    || !["live", "fixture"].includes(selection.mode)
    || (selection.runId !== "" && selection.runId !== "all" && !/^[a-f\d-]{36}$/i.test(selection.runId))) {
    throw new Error("Invalid native Workbook selection.");
  }
  const bindings: Record<string, string> = {
    "{TimeRange}": `> ago(${selection.hours}h)`,
    "{Deployment}": selection.deployment, "{Mode}": selection.mode,
    "{Model}": "all", "{StreamType}": "all",
    "{RunId:escapejson}": JSON.stringify(selection.runId).slice(1, -1),
    "{RunId:json}": JSON.stringify(selection.runId),
    "__WORKSPACE_RESOURCE_ID__": String(settings.workspaceResourceId),
    "__OPENAI_RESOURCE_ID__": String(settings.openAiResourceId),
    "__SUBSCRIPTION_ID__": String(settings.subscriptionId),
    "__RESOURCE_GROUP__": String(settings.resourceGroupName),
    "__ACTION_GROUP_ID__": String(settings.actionGroupId),
  };
  let rendered = query;
  for (const [key, value] of Object.entries(bindings)) rendered = rendered.replaceAll(key, value);
  if (/\{(TimeRange|Deployment|Mode|RunId|Model|StreamType)|__[A-Z_]+__/.test(rendered)) throw new Error("Unresolved native query binding.");
  return rendered;
}

export function tableRows(body: unknown): unknown[][] {
  const tables = record(body).tables;
  const table = Array.isArray(tables) ? record(tables[0]) : {};
  if (!Array.isArray(table.rows) || !table.rows.every(row => Array.isArray(row))) {
    throw new Error("Invalid Azure query table shape.");
  }
  return table.rows as unknown[][];
}
