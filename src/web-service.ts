import { createHash, randomUUID } from "node:crypto";
import { validatePrice, type PriceCard, type RequestEvent } from "./accounting.js";
import { reservationUsd } from "./load-policy.js";
import type { ModelConfig } from "./models.js";
import { allocateCalls, settledReservation, validateWebConfig, WebError, webLimits,
  type WebClaim } from "./web-policy.js";

export interface WebRun {
  runId: string;
  day: string;
  status: "running" | "stopping" | "stopped" | "completed";
  plan: string[];
  reservations: number[];
  accountedUsd: number;
  promptHash: string;
  inputChars: number;
  outputTokens: number;
  requestsPerSecond: number;
  concurrency: number;
  startedAt: number;
  expiresAt: string;
  fixtures: boolean;
}
export interface WebLedger {
  day: string;
  accountedUsd: number;
  limitUsd: number | null;
  activeRun: WebRun | null;
  runs?: Record<string, WebRun>;
  lastFixtureAt?: number;
}
export interface WebStore {
  readLedger(): Promise<WebLedger>;
  transaction<T>(change: (ledger: WebLedger) => Promise<T>): Promise<T>;
  listClaims(runId: string): Promise<WebClaim[]>;
  countActive(runId: string, now: number): Promise<number>;
  claim(runId: string, index: number, startedAt: number): Promise<boolean>;
  complete(runId: string, index: number, event: RequestEvent): Promise<void>;
  cancel(runId: string, index: number): Promise<void>;
}
const money = (value: number) => Math.round(value * 1e12) / 1e12;
const hash = (prompt: string) => createHash("sha256").update(prompt).digest("hex");
const budget = (ledger: WebLedger) => ({ accountedUsd: ledger.accountedUsd, limitUsd: null });

export class WebService {
  constructor(private readonly store: WebStore, readonly models: ModelConfig[],
    readonly prices: Map<string, PriceCard>, private readonly now = Date.now) {}

  private rollDay(ledger: WebLedger): void {
    ledger.limitUsd = null;
    ledger.runs ??= {};
    if (ledger.activeRun && !ledger.runs[ledger.activeRun.runId]) {
      ledger.runs[ledger.activeRun.runId] = ledger.activeRun;
    }
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (ledger.day !== day) {
      ledger.day = day;
      ledger.accountedUsd = 0;
    }
  }
  private current(ledger: WebLedger, runId: string): WebRun {
    const run = ledger.runs?.[runId] ?? (ledger.activeRun?.runId === runId ? ledger.activeRun : null);
    if (!run) throw new WebError(404, "Run not found. Reload the app.");
    if (ledger.activeRun?.runId === runId) ledger.activeRun = run;
    return run;
  }

  async start(value: unknown) {
    validateWebConfig(value, this.models);
    return this.store.transaction(async ledger => {
      this.rollDay(ledger);
      const plan = allocateCalls(value);
      const reservations = plan.map(deployment => {
        const model = this.models.find(m => m.deployment === deployment);
        const price = this.prices.get(deployment);
        if (!model || !price) throw new Error("Configured model price is missing.");
        validatePrice(price, model, ledger.day);
        return reservationUsd(price, value.outputTokens);
      });
      const reserve = money(reservations.reduce((sum, amount) => sum + amount, 0));
      const run: WebRun = {
        runId: randomUUID(), day: ledger.day, status: "running", plan, reservations, accountedUsd: reserve,
        promptHash: hash(value.prompt), inputChars: value.prompt.length, outputTokens: value.outputTokens,
        requestsPerSecond: value.requestsPerSecond, concurrency: value.concurrency, startedAt: this.now(),
        expiresAt: new Date(Math.min(this.now() + Math.ceil(value.totalCalls / value.requestsPerSecond) * 1000 + 90000,
          Date.parse(`${ledger.day}T00:00:00Z`) + 86400000)).toISOString(),
        fixtures: value.fixtures,
      };
      ledger.activeRun = run;
      ledger.runs ??= {};
      ledger.runs[run.runId] = run;
      ledger.accountedUsd = money(ledger.accountedUsd + reserve);
      return { ...run, budget: budget(ledger) };
    });
  }

  async admit(runId: string, index: number, prompt: string) {
    const ledger = await this.store.readLedger();
    const run = this.current(ledger, runId);
    if (run.status !== "running" || this.now() >= Date.parse(run.expiresAt)) {
      throw new WebError(409, "Run stopped or expired. No new model calls are allowed.");
    }
    if (!Number.isSafeInteger(index) || index < 0 || index >= run.plan.length || hash(prompt) !== run.promptHash) {
      throw new WebError(400, "Invalid call permit or changed input.");
    }
    if (this.now() < run.startedAt + index * 1000 / run.requestsPerSecond - 100) {
      throw new WebError(429, "Call exceeds the configured pacing window; not an Azure model 429.");
    }
    if (!await this.store.claim(runId, index, this.now())) throw new WebError(409, "Call permit already used.");
    const latest = await this.store.readLedger();
    if (this.current(latest, runId).status !== "running"
      || this.now() >= Date.parse(run.expiresAt)) {
      await this.store.cancel(runId, index);
      throw new WebError(409, "Run stopped before model invocation.");
    }
    const model = this.models.find(m => m.deployment === run.plan[index]);
    const price = model && this.prices.get(model.deployment);
    if (!model || !price) throw new Error("Admitted model missing.");
    return { run, model, price };
  }

  async complete(runId: string, index: number, event: RequestEvent): Promise<void> {
    await this.store.complete(runId, index, event);
    if (event.statusCode === 429 || event.statusCode === 401 || event.statusCode === 403) await this.stop(runId);
  }

  async stop(runId: string) {
    await this.store.transaction(async ledger => {
      const run = this.current(ledger, runId);
      if (run.status === "running") run.status = "stopping";
    });
    return this.status(runId);
  }

  async status(runId: string) {
    const initial = await this.store.readLedger();
    const initialRun = this.current(initial, runId);
    if (initialRun.status === "running" && this.now() >= Date.parse(initialRun.expiresAt)) {
      await this.store.transaction(async ledger => { this.current(ledger, runId).status = "stopping"; });
    }
    return this.store.transaction(async ledger => {
      this.rollDay(ledger);
      const run = this.current(ledger, runId);
      const claims = await this.store.listClaims(runId);
      const pending = claims.some(c => !c.event && !c.cancelled && this.now() - c.startedAt < 60000);
      const finished = claims.filter(c => c.event || c.cancelled || this.now() - c.startedAt >= 60000).length;
      if (run.status === "running" && finished === run.plan.length) run.status = "completed";
      if (run.status === "stopping" && !pending) run.status = "stopped";
      const issued = new Set(claims.map(c => c.index));
      const unused = run.status === "running"
        ? run.reservations.reduce((sum, amount, index) => sum + (issued.has(index) ? 0 : amount), 0) : 0;
      const accounted = money(settledReservation(run.reservations, claims) + unused);
      if (run.day === ledger.day) ledger.accountedUsd = money(ledger.accountedUsd + accounted - run.accountedUsd);
      run.accountedUsd = accounted;
      const events = claims.flatMap(c => c.event ? [c.event] : []);
      return {
        runId, status: run.status, expiresAt: run.expiresAt, plan: run.plan, completed: finished,
        attempts: claims.filter(c => !c.cancelled).length,
        successes: events.filter(e => e.outcome === "success").length,
        throttled: events.filter(e => e.outcome === "throttled").length,
        blocked: events.filter(e => ["input_blocked", "output_blocked"].includes(e.outcome)).length,
        events, budget: budget(ledger),
      };
    });
  }

  async config() {
    const ledger = await this.store.readLedger();
    const runs = Object.values(ledger.runs ?? (ledger.activeRun ? { [ledger.activeRun.runId]: ledger.activeRun } : {}));
    for (const run of runs) {
      if (["running", "stopping"].includes(run.status)) await this.status(run.runId);
    }
    const current = await this.store.transaction(async state => { this.rollDay(state); return state; });
    return { models: this.models, limits: webLimits, budget: budget(current), activeRun: null };
  }
}
