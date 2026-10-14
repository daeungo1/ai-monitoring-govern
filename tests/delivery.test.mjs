import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";
import { execFileSync } from "node:child_process";

test("every request panel filters mode and costs remain nullable", async () => {
  const workbook = JSON.parse(await readFile("infra/workbook.json", "utf8"));
  const panels = workbook.items.filter(item => item.type === 3);
  assert.ok(panels.length >= 15);
  for (const panel of panels.filter(item => item.content.query.includes("AppDependencies"))) {
    assert.ok(panel.content.query.includes('tostring(Properties["demo.mode"]) == "{Mode}"'), panel.name);
  }
  for (const name of ["kpis", "cost-models"]) {
    assert.ok(panels.find(p => p.name === name).content.query.includes("PricedAttempts==0,real(null)"));
  }
});
test("all README local Markdown targets exist", async () => {
  const text = await readFile("README.md", "utf8");
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])
    .filter(target => !target.includes("://"));
  for (const link of links) await access(link);
});
test("all paid log alerts are live-only and no raw request/response diagnostics are enabled", async () => {
  const bicep = await readFile("infra/resources.bicep", "utf8");
  assert.ok(bicep.includes('Properties["demo.mode"] == "live"'));
  assert.ok(bicep.includes("disableLocalAuth: true"));
  assert.ok(!bicep.includes("category: 'RequestResponse'"));
  assert.ok(!bicep.includes("categoryGroup: 'allLogs'"));
  assert.ok(bicep.includes("raiPolicyName: safetyPolicy.name"));
});
test("PowerShell deployment helper forwards every native CLI argument", { skip: process.platform !== "win32" }, () => {
  const output = execFileSync("pwsh", ["-NoProfile", "-Command", [
    ". .\\scripts\\Deploy-Demo.ps1 -SubscriptionId demo -ResourceGroupName demo -ResourcePrefix demo",
    "function az { $global:LASTEXITCODE = 0; $args -join ',' }",
    "Invoke-Azure @('account','show','--subscription','demo')"
  ].join("; ")], { encoding: "utf8", timeout: 120000 });
  assert.equal(output.trim(), "account,show,--subscription,demo");
});
test("deployment wrapper uses az deployment sub operation command ordering", async () => {
  const source = await readFile("scripts/Deploy-Demo.ps1", "utf8");
  for (const operation of ["validate", "what-if", "create"]) {
    assert.ok(source.includes(`@('deployment', 'sub', '${operation}')`), operation);
  }
});
test("query-only verification does not fetch ingestion configuration", async () => {
  const source = await readFile("scripts/Use-Demo.ps1", "utf8");
  assert.ok(source.includes("if ($Mode -in @('live', 'replay'))"));
});
