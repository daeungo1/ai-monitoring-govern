import { record, type RequestEvent } from "./accounting.js";

export const webLimits = Object.freeze({
  totalCalls: 500, requestsPerSecond: 50, concurrency: null, inputChars: 3500,
  outputTokens: 512, dailyBudgetUsd: null,
});
export class WebError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export interface WebConfig {
  prompt: string;
  outputTokens: number;
  totalCalls: number;
  requestsPerSecond: number;
  concurrency: number;
  fixtures: boolean;
  allocations: { deployment: string; percent: number }[];
}
export interface WebClaim {
  index: number;
  startedAt: number;
  event?: RequestEvent;
  cancelled?: boolean;
}

export function validateWebConfig(value: unknown, models: { deployment: string }[]): asserts value is WebConfig {
  const c = record(value);
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  if (typeof c.prompt !== "string" || !c.prompt.trim()
    || Buffer.byteLength(c.prompt, "utf8") > webLimits.inputChars
    || !integer(c.outputTokens, 16, webLimits.outputTokens)
    || !integer(c.totalCalls, 1, webLimits.totalCalls)
    || !integer(c.requestsPerSecond, 1, webLimits.requestsPerSecond)
    || !integer(c.concurrency, 1, Number.MAX_SAFE_INTEGER) || typeof c.fixtures !== "boolean"
    || !Array.isArray(c.allocations) || c.allocations.length < 1 || c.allocations.length > models.length) {
    throw new WebError(400, "Invalid test limits. Input must fit 3500 UTF-8 bytes; calls1..500, output16..512, RPS1..50, concurrency must be a positive safe integer.");
  }
  const names = new Set<string>();
  let total = 0;
  for (const item of c.allocations) {
    const a = record(item);
    if (typeof a.deployment !== "string" || !models.some(m => m.deployment === a.deployment)
      || names.has(a.deployment) || !integer(a.percent, 0, 100)) {
      throw new WebError(400, "Model allocations must use unique configured deployments and integer percentages.");
    }
    names.add(a.deployment);
    total += Number(a.percent);
  }
  if (total !== 100) throw new WebError(400, "Model percentages must total exactly 100.");
}

export function allocateCalls(config: Pick<WebConfig, "totalCalls" | "allocations">): string[] {
  const quotas = config.allocations.map((a, index) => ({
    ...a, index, count: Math.floor(config.totalCalls * a.percent / 100),
    remainder: config.totalCalls * a.percent / 100 % 1, issued: 0,
  }));
  const remainder = config.totalCalls - quotas.reduce((sum, q) => sum + q.count, 0);
  const sorted = [...quotas].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remainder; i++) {
    const quota = sorted[i];
    if (quota) quota.count++;
  }
  const plan: string[] = [];
  for (let i = 0; i < config.totalCalls; i++) {
    const next = quotas.filter(q => q.issued < q.count)
      .sort((a, b) => (a.issued + 1) / a.count - (b.issued + 1) / b.count || a.index - b.index)[0];
    if (!next) throw new Error("Allocation failed.");
    next.issued++;
    plan.push(next.deployment);
  }
  return plan;
}

export function settledReservation(reservations: number[], claims: Pick<WebClaim, "index" | "event" | "cancelled">[]): number {
  return Math.round(claims.reduce((sum, claim) =>
    sum + (claim.cancelled ? 0 : claim.event?.estimatedCostUsd ?? reservations[claim.index] ?? 0), 0) * 1e12) / 1e12;
}
