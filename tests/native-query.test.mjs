import assert from "node:assert/strict";
import { test } from "node:test";
import { renderWorkbookQuery, tableRows } from "../dist/native-monitoring.js";
test("Workbook query verification mirrors actual time/deployment/mode/run bindings", () => {
  const query = 'TimeGenerated {TimeRange} | where Model=="{Deployment}" and Mode=="{Mode}"; let Run=tostring(dynamic({RunId:json}));';
  const rendered = renderWorkbookQuery(query, { hours: 24, deployment: "gpt-6-luna", mode: "live", runId: "" }, {});
  assert.ok(rendered.includes("> ago(24h)"));
  assert.ok(rendered.includes('dynamic("")'));
  assert.ok(!rendered.includes("{TimeRange}"));
  assert.throws(() => renderWorkbookQuery(query, { hours: 0, deployment: "x", mode: "live", runId: "" }, {}));
});
test("native verifier never treats absent or malformed tables as success", () => {
  assert.throws(() => tableRows({ tables: [] }));
  assert.throws(() => tableRows({ tables: [{ rows: [1] }] }));
  assert.deepEqual(tableRows({ tables: [{ rows: [[null, 2]] }] }), [[null, 2]]);
});
