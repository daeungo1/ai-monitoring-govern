import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderDailyReport } from "../dist/daily-report.js";

const base = {
  day: "2026-10-15", timestamp: "2026-10-15T01:00:00.000Z", workerId: "worker-1", pid: 1234, status: "running", active: 2,
  summary: { attempts: 200, successes: 150, knownUsage: 150, unknownCost: 50, inputTokens: 1000, outputTokens: 500, estimatedUsd: 0.5 },
  budgetAccountedUsd: 1.25, dailyBudgetUsd: 20,
  groups: [{ profile: "short-64", model: "gpt-5.6-luna", attempts: 10, successes: 10, inputTokens: 480, outputTokens: 640,
    ttftP95Ms: null, estimatedUsd: 0.001, unknownCost: 0 }],
  scenarioCycles: 1, syntheticEvents: 27, scenarioInterval: 3600, lastBurst: { targetRps: 30 },
};

test("daily report states the customer requirements and where each one is answered", () => {
  const text = renderDailyReport(base);
  for (const phrase of ["고객 요건", "핵심 메트릭", "실시간 비용", "추가 운영 팁", "가드레일", "Log Analytics"]) {
    assert.ok(text.includes(phrase), phrase);
  }
});

test("daily report computes rates and never turns unknown cost or usage into zero", () => {
  const text = renderDailyReport(base);
  assert.ok(text.includes("75.0%"), "success and usage coverage rate");
  const empty = renderDailyReport({ ...base, summary: { ...base.summary, attempts: 0, successes: 0, knownUsage: 0,
    unknownCost: 0, estimatedUsd: null }, groups: [] });
  assert.ok(empty.includes("N/A"));
  assert.ok(empty.includes("아직 측정 없음"));
  assert.ok(!/추정 USD[^\n]*\b0\.000000\b/.test(empty));
});

test("every profile table row has the same number of cells as the header", () => {
  for (const input of [base, { ...base, groups: [] }]) {
    const rows = renderDailyReport(input).split("\n").filter(line => /^\| (Profile|short-64|아직 측정 없음)/.test(line));
    assert.ok(rows.length >= 2);
    const cells = line => line.split("|").length - 2;
    for (const row of rows) assert.equal(cells(row), cells(rows[0]), row);
  }
});

test("daily report no longer claims the removed shared web budget and links only to existing files", async () => {
  const text = renderDailyReport(base);
  assert.ok(!text.includes("공유 예산 계상액"));
  assert.ok(text.includes("앱이 정한 비용·동시 실행 상한이 없습니다"));
  const links = [...text.matchAll(/\]\(([^)#]+)\)/g)].map(match => match[1]).filter(target => !target.includes("://"));
  assert.ok(links.length > 3);
  for (const link of links) await access(link);
});

test("the committed daily report uses the generator's structure", async () => {
  const committed = await readFile("dailyreport.md", "utf8");
  for (const heading of ["## 이 문서는 무엇인가요", "## 고객 요건과 이 보고서의 답", "## 프로파일별 측정"]) {
    assert.ok(committed.includes(heading), heading);
  }
});
