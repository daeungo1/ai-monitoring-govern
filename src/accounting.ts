import type { Attributes } from "@opentelemetry/api";

export interface PriceCard {
  model: string;
  modelVersion: string;
  deploymentSku: string;
  currency: "USD";
  inputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  outputPerMillion: number | null;
  effectiveFrom: string;
  effectiveTo: string;
  source: string;
  status: "illustrative" | "verified" | "unconfigured";
  maxPromptTokens?: number;
}

export interface RequestContext {
  runId: string;
  mode: "live" | "fixture";
  deployment: string;
  model: string;
  modelVersion: string;
  deploymentSku: string;
  latencyMs: number;
}

export type Outcome = "success" | "input_blocked" | "output_blocked" | "throttled"
  | "client_error" | "server_error" | "network_error" | "filter_unavailable" | "stream_incomplete" | "stream_cancelled";

export interface StreamMeasurements {
  firstChunkMs: number | null;
  ttftMs: number | null;
  durationMs: number;
  interChunkMeanMs: number | null;
  interChunkMaxMs: number | null;
  chunkCount: number;
  contentChunkCount: number;
  completed: boolean;
}

export interface FilterAnnotation {
  source: "prompt" | "completion";
  category: string;
  severity: string;
  filtered: boolean;
  detected: boolean;
}

export interface RequestEvent extends RequestContext {
  statusCode: number;
  outcome: Outcome;
  usageKnown: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  cacheDetailsKnown: boolean;
  estimatedCostUsd: number | null;
  costKnown: boolean;
  costReason: "estimated" | "usage_missing" | "rate_unconfigured" | "price_scope_unsupported";
  priceStatus: PriceCard["status"];
  priceEffectiveFrom: string;
  priceSource: string;
  filterObserved: boolean;
  filters: FilterAnnotation[];
  stream?: StreamMeasurements;
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function tokenCount(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} tokens: expected a non-negative safe integer.`);
  }
  return value;
}

function usageDetails(usage: unknown) {
  const value = record(usage);
  if (value.prompt_tokens === undefined || value.completion_tokens === undefined) return null;
  const prompt = tokenCount(value.prompt_tokens, "prompt");
  const completion = tokenCount(value.completion_tokens, "completion");
  const cachedValue = record(value.prompt_tokens_details).cached_tokens;
  const cached = cachedValue === undefined ? 0 : tokenCount(cachedValue, "cached");
  if (cached > prompt) throw new Error("Cached tokens exceed prompt tokens.");
  return { prompt, completion, cached, cacheDetailsKnown: cachedValue !== undefined };
}

export function validatePrice(
  value: unknown, context: Pick<RequestContext, "model" | "modelVersion" | "deploymentSku">,
  day = new Date().toISOString().slice(0, 10),
): asserts value is PriceCard {
  const p = record(value);
  const validDay = (date: unknown): date is string => typeof date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
  if (p.model !== context.model || p.modelVersion !== context.modelVersion
      || p.deploymentSku !== context.deploymentSku || p.currency !== "USD"
      || !validDay(p.effectiveFrom) || !validDay(p.effectiveTo) || !validDay(day)
      || p.effectiveFrom > day || p.effectiveTo <= day
      || typeof p.source !== "string" || !p.source.startsWith("https://")
      || (p.status !== "illustrative" && p.status !== "verified" && p.status !== "unconfigured")) {
    throw new Error("Invalid price card: model/version/SKU, currency, dates or provenance mismatch.");
  }
  for (const key of ["inputPerMillion", "cachedInputPerMillion", "outputPerMillion"]) {
    if (p.status === "unconfigured" && p[key] === null) continue;
    if (typeof p[key] !== "number" || !Number.isFinite(p[key]) || p[key] < 0) {
      throw new Error(`Invalid price rate: ${key}.`);
    }
  }
  if (p.status === "unconfigured" && ["inputPerMillion", "cachedInputPerMillion", "outputPerMillion"]
    .some(key => p[key] !== null)) throw new Error("Unconfigured price card must use null for every rate.");
}

export function estimateCost(usage: unknown, price: PriceCard): number | null {
  const detail = usageDetails(usage);
  if (detail === null) return null;
  if (price.maxPromptTokens !== undefined && detail.prompt > price.maxPromptTokens) return null;
  const promptDetails = record(record(usage).prompt_tokens_details);
  if (["cache_creation_tokens", "cache_write_tokens"].some(key =>
    promptDetails[key] !== undefined && promptDetails[key] !== 0)) return null;
  if (price.status === "unconfigured") return null;
  if (price.inputPerMillion === null || price.cachedInputPerMillion === null || price.outputPerMillion === null) {
    throw new Error("Configured price card cannot have null rates.");
  }
  const cost = ((detail.prompt - detail.cached) * price.inputPerMillion
    + detail.cached * price.cachedInputPerMillion + detail.completion * price.outputPerMillion) / 1_000_000;
  return Math.round(cost * 1e12) / 1e12;
}

const filterCategories = ["hate", "sexual", "violence", "self_harm", "jailbreak", "indirect_attack",
  "protected_material_text", "protected_material_code", "groundedness", "pii"];
const severities = new Set(["safe", "low", "medium", "high"]);

function parseFilters(value: unknown, source: FilterAnnotation["source"]) {
  const object = record(value);
  const annotations: FilterAnnotation[] = [];
  for (const category of filterCategories) {
    const result = record(object[category]);
    if (typeof result.filtered !== "boolean" && typeof result.detected !== "boolean") continue;
    annotations.push({
      source, category,
      severity: typeof result.severity === "string" && severities.has(result.severity) ? result.severity : "unknown",
      filtered: result.filtered === true, detected: result.detected === true,
    });
  }
  return { annotations, unavailable: object.error !== undefined };
}

function createEvent(context: RequestContext, price: PriceCard, usage: unknown,
  statusCode: number, outcome: Outcome, filters: FilterAnnotation[]): RequestEvent {
  const detail = usageDetails(usage);
  const estimatedCostUsd = estimateCost(usage, price);
  return {
    ...context, statusCode, outcome,
    usageKnown: detail !== null, promptTokens: detail?.prompt ?? null,
    completionTokens: detail?.completion ?? null, cachedTokens: detail?.cached ?? null,
    cacheDetailsKnown: detail?.cacheDetailsKnown ?? false, estimatedCostUsd, costKnown: estimatedCostUsd !== null,
    costReason: estimatedCostUsd !== null ? "estimated" : detail === null ? "usage_missing"
      : price.status === "unconfigured" ? "rate_unconfigured" : "price_scope_unsupported",
    priceStatus: price.status, priceEffectiveFrom: price.effectiveFrom, priceSource: price.source,
    filterObserved: filters.length > 0, filters,
  };
}

export function normalizeResponse(response: unknown, context: RequestContext, price: PriceCard): RequestEvent {
  const value = record(response);
  const filters: FilterAnnotation[] = [];
  let unavailable = false;
  let blocked = false;
  if (Array.isArray(value.prompt_filter_results)) {
    for (const result of value.prompt_filter_results) {
      const parsed = parseFilters(record(result).content_filter_results, "prompt");
      filters.push(...parsed.annotations);
      unavailable ||= parsed.unavailable;
    }
  }
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      const item = record(choice);
      const parsed = parseFilters(item.content_filter_results, "completion");
      filters.push(...parsed.annotations);
      unavailable ||= parsed.unavailable;
      blocked ||= item.finish_reason === "content_filter" || parsed.annotations.some(f => f.filtered);
    }
  }
  return createEvent(context, price, value.usage, 200,
    blocked ? "output_blocked" : unavailable ? "filter_unavailable" : "success", filters);
}

export function normalizeError(error: unknown, context: RequestContext, price: PriceCard): RequestEvent {
  const outer = record(error);
  const body = record(outer.error);
  const inner = record(body.innererror);
  const status = typeof outer.status === "number" && Number.isInteger(outer.status)
    && outer.status >= 100 && outer.status <= 599 ? outer.status : 0;
  const parsed = parseFilters(inner.content_filter_result ?? inner.content_filter_results, "prompt");
  const outcome: Outcome = body.code === "content_filter" || inner.code === "ResponsibleAIPolicyViolation"
    ? "input_blocked" : status === 429 ? "throttled" : status >= 500 ? "server_error"
    : status >= 400 ? "client_error" : "network_error";
  return createEvent(context, price, undefined, status, outcome, parsed.annotations);
}

export function toAttributes(event: RequestEvent): Attributes {
  const attributes: Attributes = {
    "telemetry.kind": "aoai.request",
    "demo.run_id": event.runId,
    "demo.mode": event.mode,
    "aoai.deployment": event.deployment,
    "gen_ai.system": "azure.openai",
    "gen_ai.request.model": event.model,
    "aoai.model_version": event.modelVersion,
    "aoai.deployment_sku": event.deploymentSku,
    "aoai.status_code": event.statusCode,
    "aoai.outcome": event.outcome,
    "aoai.latency_ms": event.latencyMs,
    "aoai.usage_known": event.usageKnown,
    "aoai.cache_details_known": event.cacheDetailsKnown,
    "aoai.cost_known": event.costKnown,
    "aoai.cost_reason": event.costReason,
    "aoai.price_status": event.priceStatus,
    "aoai.price_effective_from": event.priceEffectiveFrom,
    "aoai.price_source": event.priceSource,
    "aoai.filter_observed": event.filterObserved,
    "aoai.filters": JSON.stringify(event.filters),
  };
  if (event.promptTokens !== null) attributes["aoai.prompt_tokens"] = event.promptTokens;
  if (event.completionTokens !== null) attributes["aoai.completion_tokens"] = event.completionTokens;
  if (event.cachedTokens !== null) attributes["aoai.cached_tokens"] = event.cachedTokens;
  if (event.estimatedCostUsd !== null) attributes["aoai.estimated_cost_usd"] = event.estimatedCostUsd;
  attributes["aoai.streaming"] = event.stream !== undefined;
  if (event.stream) {
    attributes["aoai.stream_duration_ms"] = event.stream.durationMs;
    attributes["aoai.stream_completed"] = event.stream.completed;
    attributes["aoai.chunk_count"] = event.stream.chunkCount;
    attributes["aoai.content_chunk_count"] = event.stream.contentChunkCount;
    if (event.stream.firstChunkMs !== null) attributes["aoai.first_chunk_ms"] = event.stream.firstChunkMs;
    if (event.stream.ttftMs !== null) attributes["aoai.ttft_ms"] = event.stream.ttftMs;
    if (event.stream.interChunkMeanMs !== null) attributes["aoai.inter_chunk_mean_ms"] = event.stream.interChunkMeanMs;
    if (event.stream.interChunkMaxMs !== null) attributes["aoai.inter_chunk_max_ms"] = event.stream.interChunkMaxMs;
  }
  return attributes;
}
