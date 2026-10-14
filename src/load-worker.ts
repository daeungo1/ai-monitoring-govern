import { readFile, writeFile, appendFile, mkdir, open, unlink, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { record, type PriceCard } from "./accounting.js";
import { loadModels, loadPriceCards } from "./models.js";
import { Telemetry } from "./telemetry.js";
import { invokeLoad, loadClient } from "./load-api.js";
import { validateLoadConfig, selectWave, selectBurst, makePrompt, reservationUsd, budgetAllows, summarizeLoad, type LoadEvent } from "./load-policy.js";
import { createDemoScenarioEvents, scenarioIntervalSeconds, scenarioDue } from "./demo-scenarios.js";
import { renderDailyReport } from "./daily-report.js";

interface Budget { day: string; accountedUsd: number; pending: number; }
const directory = "artifacts/loadtest";
async function atomicWrite(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}
async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error: unknown) { if (record(error).code === "ENOENT") return false; throw error; }
}
async function main(): Promise<void> {
  const rawConfig: unknown = JSON.parse(await readFile("config/load-test.json", "utf8"));
  validateLoadConfig(rawConfig);
  const config = rawConfig;
  const scenarioInterval = scenarioIntervalSeconds(process.env.LOAD_SCENARIO_INTERVAL_SECONDS);
  const settings = record(JSON.parse(await readFile("artifacts/settings.json", "utf8")));
  const endpoint = settings.endpoint;
  const connection = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (typeof endpoint !== "string" || !connection) throw new Error("Load settings/ingestion connection missing.");
  const models = await loadModels("config/models.json");
  const maxWaves = process.env.LOAD_MAX_WAVES === undefined ? null : Number(process.env.LOAD_MAX_WAVES);
  if (maxWaves !== null && (!Number.isInteger(maxWaves) || maxWaves < 1 || maxWaves > 100)) {
    throw new Error("LOAD_MAX_WAVES must be 1..100 or unset for continuous mode.");
  }
  await mkdir(directory, { recursive: true });
  const lockPath = `${directory}/worker.lock`;
  if (await exists(lockPath)) {
    const old = record(JSON.parse(await readFile(lockPath, "utf8")));
    if (typeof old.pid !== "number") throw new Error("Invalid existing load lock; inspect before restart.");
    try { process.kill(old.pid, 0); throw new Error("Load worker already running; duplicate spending prevented."); }
    catch (error: unknown) { if (record(error).code !== "ESRCH") throw error; }
    await unlink(lockPath);
  }
  const workerId = randomUUID();
  const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, workerId }));
  let stopping = false, status = "starting", wave = 0, active = 0;
  let lastScenario: number | null = null, scenarioCycles = 0, syntheticEvents = 0;
  let lastBurstAt: number | null = null;
  let lastBurst: { targetRps: number; issued: number; peakInflight: number; peakStartsPerSecond: number } | null = null;
  const abort = new AbortController();
  process.on("SIGINT", () => { stopping = true; abort.abort(); });
  process.on("SIGTERM", () => { stopping = true; abort.abort(); });
  const client = loadClient(endpoint, config.requestTimeoutMs);
  const telemetry = new Telemetry(connection);
  const budgets = new Map<string, Budget>();
  let writes: Promise<void> = Promise.resolve();
  let snapshots: Promise<void> = Promise.resolve();
  const day = () => new Date().toISOString().slice(0, 10);
  async function budgetFor(today: string): Promise<Budget> {
    let budget = budgets.get(today);
    if (!budget) {
      const file = `${directory}/${today}-budget.json`;
      const saved = await exists(file) ? record(JSON.parse(await readFile(file, "utf8"))) : {};
      if (Object.keys(saved).length && (saved.day !== today || typeof saved.accountedUsd !== "number"
        || !Number.isFinite(saved.accountedUsd) || saved.accountedUsd < 0
        || typeof saved.pending !== "number" || !Number.isInteger(saved.pending) || saved.pending < 0)) {
        throw new Error("Invalid persisted budget; refusing to reset spending to zero.");
      }
      budget = { day: today, accountedUsd: typeof saved.accountedUsd === "number" ? saved.accountedUsd : 0,
        pending: typeof saved.pending === "number" ? saved.pending : 0 };
      budgets.set(today, budget);
    }
    return budget;
  }
  function persistBudget(budget: Budget): Promise<void> {
    const json = JSON.stringify(budget, null, 2);
    writes = writes.then(() => atomicWrite(`${directory}/${budget.day}-budget.json`, json));
    return writes;
  }
  function appendJournal(today: string, event: LoadEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    writes = writes.then(() => appendFile(`${directory}/${today}.jsonl`, line));
    return writes;
  }
  async function journal(today: string): Promise<LoadEvent[]> {
    const file = `${directory}/${today}.jsonl`;
    if (!(await exists(file))) return [];
    return (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as LoadEvent);
  }
  async function snapshotNow(): Promise<void> {
    await writes;
    const today = day(), budget = await budgetFor(today);
    const events = await journal(today);
    const summary = summarizeLoad(events);
    const timestamp = new Date().toISOString();
    await atomicWrite(`${directory}/status.json`, JSON.stringify({
      pid: process.pid, workerId, status, updatedAt: timestamp, wave, active,
      ...summary, dailyBudgetUsd: config.dailyBudgetUsd, accountedUsd: budget.accountedUsd, pendingReservations: budget.pending,
      budgetAlertThresholdUsd: config.dailyBudgetUsd * 0.7, budgetUtilization: budget.accountedUsd / config.dailyBudgetUsd,
      scenarioIntervalSeconds: scenarioInterval, scenarioCycles, syntheticEvents, lastBurst,
    }, null, 2));
    const groups = new Map<string, LoadEvent[]>();
    for (const event of events) {
      const key = `${event.profile} | ${event.model}`;
      const entries = groups.get(key) ?? []; entries.push(event); groups.set(key, entries);
    }
    const reportGroups = [...groups.values()].flatMap(values => {
      const first = values[0];
      if (!first) return [];
      const s = summarizeLoad(values);
      return [{ profile: first.profile, model: first.model, attempts: s.attempts, successes: s.successes,
        inputTokens: s.inputTokens, outputTokens: s.outputTokens, ttftP95Ms: s.ttftP95Ms,
        estimatedUsd: s.estimatedUsd, unknownCost: s.unknownCost }];
    });
    await atomicWrite("dailyreport.md", renderDailyReport({
      day: today, timestamp, workerId, pid: process.pid, status, active, summary,
      budgetAccountedUsd: budget.accountedUsd, dailyBudgetUsd: config.dailyBudgetUsd, groups: reportGroups,
      scenarioCycles, syntheticEvents, scenarioInterval, lastBurst,
    }));
  }
  function snapshot(): Promise<void> {
    snapshots = snapshots.then(snapshotNow);
    return snapshots;
  }
  async function wait(seconds: number): Promise<void> {
    for (let elapsed = 0; elapsed < seconds && !stopping; elapsed++) {
      if (await exists(`${directory}/STOP`)) { stopping = true; abort.abort(); break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const heartbeat = setInterval(() => {
    if (!stopping) void exists(`${directory}/STOP`).then(found => {
      if (found) { stopping = true; abort.abort(); }
      return snapshot();
    }).catch(() => { console.error("Load heartbeat persistence failed."); stopping = true; abort.abort(); });
  }, 10000);
  try {
    await snapshot();
    console.log(JSON.stringify({ workerId, pid: process.pid, status: "started", dailyBudgetUsd: config.dailyBudgetUsd }));
    while (!stopping) {
      if (await exists(`${directory}/STOP`)) { stopping = true; break; }
      let prices: Map<string, PriceCard>;
      try { prices = await loadPriceCards("config/model-prices.json", models); }
      catch { status = "price_configuration_paused"; await snapshot(); await wait(300); continue; }
      status = "running";
      const today = day(), budget = await budgetFor(today);
      const now = Date.now() / 1000;
      if (scenarioDue(now, lastScenario, scenarioInterval)) {
        const scenarios = createDemoScenarioEvents(models, prices, workerId);
        await appendFile(`${directory}/${today}-scenarios.jsonl`,
          scenarios.map(event => JSON.stringify({ ...event, timestamp: new Date().toISOString() })).join("\n") + "\n");
        for (const event of scenarios) telemetry.emit(event);
        syntheticEvents += scenarios.length; scenarioCycles++; lastScenario = now;
        console.log(JSON.stringify({ source: "fixture", workerId, events: scenarios.length, scenarioCycles }));
      }
      const burst = config.burst && (lastBurstAt === null || now - lastBurstAt >= config.burst.intervalSeconds)
        ? config.burst : null;
      const work = burst ? selectBurst(burst, models) : selectWave(config, models, wave);
      wave++;
      if (burst) {
        lastBurstAt = now;
        lastBurst = { targetRps: burst.requestsPerSecond, issued: 0, peakInflight: 0, peakStartsPerSecond: 0 };
      }
      const waveStarted = performance.now();
      const startBuckets = new Map<number, number>();
      let next = 0, authErrors = false, throttled = false, dependencyError = false;
      async function consumer(): Promise<void> {
        while (next < work.length && !stopping && !authErrors && !throttled) {
          const index = next++;
          const item = work[index];
          if (!item) break;
          if (burst) {
            const delayMs = Math.max(0, index * 1000 / burst.requestsPerSecond - (performance.now() - waveStarted));
            await new Promise(resolve => setTimeout(resolve, delayMs));
            if (stopping || authErrors || throttled) break;
            // Do not catch up missed deadlines with an unpaced late flood.
            if (performance.now() - waveStarted >= burst.durationSeconds * 1000) break;
          }
          const price = prices.get(item.model.deployment);
          if (!price) throw new Error("Verified load price missing.");
          const reservedUsd = reservationUsd(price, item.profile.outputTokens);
          if (!budgetAllows(budget.accountedUsd, reservedUsd, config.dailyBudgetUsd)) { status = "daily_budget_paused"; break; }
          budget.accountedUsd += reservedUsd; budget.pending++;
          await persistBudget(budget);
          const prompt = makePrompt(item.profile);
          active++;
          const requestStartedAt = new Date().toISOString();
          if (burst && lastBurst) {
            const bucket = Math.floor((performance.now() - waveStarted) / 1000);
            const starts = (startBuckets.get(bucket) ?? 0) + 1;
            startBuckets.set(bucket, starts);
            lastBurst.issued++;
            lastBurst.peakInflight = Math.max(lastBurst.peakInflight, active);
            lastBurst.peakStartsPerSecond = Math.max(lastBurst.peakStartsPerSecond, starts);
          }
          const event = await invokeLoad(client, {
            runId: randomUUID(), mode: "live", deployment: item.model.deployment, model: item.model.model,
            modelVersion: item.model.modelVersion, deploymentSku: item.model.deploymentSku, latencyMs: 0,
            workload: "continuous-load", profile: item.profile.id, workerId, requestedMaxTokens: item.profile.outputTokens, inputChars: prompt.length,
          }, price, item.profile, prompt, abort.signal);
          active--;
          budget.accountedUsd += (event.estimatedCostUsd ?? reservedUsd) - reservedUsd; budget.pending--;
          await persistBudget(budget);
          const entry: LoadEvent & { requestStartedAt: string } = { ...event, profile: item.profile.id, reservedUsd,
            requestStartedAt, timestamp: new Date().toISOString() };
          await appendJournal(today, entry);
          telemetry.emit(event);
          authErrors ||= event.statusCode === 401 || event.statusCode === 403;
          throttled ||= event.statusCode === 429;
          dependencyError ||= event.outcome === "network_error";
          console.log(JSON.stringify({ profile: item.profile.id, model: item.model.model, outcome: event.outcome,
            input: event.promptTokens, output: event.completionTokens, cost: event.estimatedCostUsd }));
        }
      }
      const results = await Promise.allSettled(Array.from({ length: burst?.maxConcurrency ?? config.concurrency },
        () => consumer().catch(error => { stopping = true; abort.abort(); throw error; })));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      telemetry.emitBudget(budget.accountedUsd, config.dailyBudgetUsd, workerId);
      try { await telemetry.flush(); }
      catch {
        status = "telemetry_export_paused";
        while (!stopping) { await snapshot(); await wait(60); }
        break;
      }
      if (authErrors) status = "authentication_paused";
      else if (throttled) status = "throttling_backoff";
      else if (dependencyError) status = "dependency_backoff";
      else if (status === "running") status = "cycle_wait";
      await snapshot();
      if (maxWaves !== null && wave >= maxWaves) break;
      await wait(authErrors ? 300 : throttled || dependencyError ? 60 : status === "daily_budget_paused" ? 60 : config.cycleDelaySeconds);
    }
  } finally {
    clearInterval(heartbeat);
    abort.abort();
    status = "stopped";
    try { await telemetry.close(); }
    finally {
      await snapshot();
      await lock.close();
      await unlink(lockPath);
    }
  }
}
main().catch(() => { console.error("Continuous load worker stopped on a critical persistence/configuration error. Inspect sanitized state."); process.exitCode = 1; });
