import { record, normalizeError, normalizeResponse, type PriceCard, type RequestContext,
  type RequestEvent, type FilterAnnotation } from "./accounting.js";

export interface StreamFailure { kind: "error" | "cancelled"; error: unknown; }

export class StreamingCollector {
  private firstChunkMs: number | null = null;
  private ttftMs: number | null = null;
  private lastContentMs: number | null = null;
  private chunkCount = 0;
  private contentChunkCount = 0;
  private readonly gaps: number[] = [];
  private readonly filters = new Map<string, FilterAnnotation>();
  private terminal = false;
  private blocked = false;
  private filterUnavailable = false;
  private usage: unknown;
  private costUnavailable = false;

  constructor(private readonly context: RequestContext, private readonly price: PriceCard) {}

  accept(chunk: unknown, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Invalid streaming elapsed time.");
    this.firstChunkMs ??= elapsedMs;
    this.chunkCount++;
    const value = record(chunk);
    const normalized = normalizeResponse(chunk, this.context, this.price);
    if (normalized.usageKnown) this.costUnavailable = !normalized.costKnown;
    if (normalized.usageKnown) this.usage = {
      prompt_tokens: normalized.promptTokens, completion_tokens: normalized.completionTokens,
      ...(normalized.cacheDetailsKnown ? { prompt_tokens_details: { cached_tokens: normalized.cachedTokens } } : {}),
    };
    for (const filter of normalized.filters) this.filters.set(JSON.stringify(filter), filter);
    this.blocked ||= normalized.outcome === "output_blocked";
    this.filterUnavailable ||= normalized.outcome === "filter_unavailable";
    let content = false;
    if (Array.isArray(value.choices)) for (const choice of value.choices) {
      const item = record(choice);
      this.terminal ||= ["stop", "length", "tool_calls", "function_call", "content_filter"].includes(String(item.finish_reason));
      const delta = record(item.delta);
      content ||= typeof delta.content === "string" && delta.content.length > 0;
    }
    if (content) {
      this.ttftMs ??= elapsedMs;
      if (this.lastContentMs !== null) this.gaps.push(Math.max(0, elapsedMs - this.lastContentMs));
      this.lastContentMs = elapsedMs;
      this.contentChunkCount++;
    }
  }

  finish(durationMs: number, failure?: StreamFailure): RequestEvent {
    const context = { ...this.context, latencyMs: durationMs };
    let event = failure ? normalizeError(failure.error, context, this.price)
      : normalizeResponse({ usage: this.usage, choices: [{ finish_reason: this.blocked ? "content_filter" : "stop" }] }, context, this.price);
    if (failure && this.usage !== undefined) {
      const accounted = normalizeResponse({ usage: this.usage }, context, this.price);
      event = {
        ...event, usageKnown: accounted.usageKnown, promptTokens: accounted.promptTokens,
        completionTokens: accounted.completionTokens, cachedTokens: accounted.cachedTokens,
        cacheDetailsKnown: accounted.cacheDetailsKnown, costKnown: accounted.costKnown,
        estimatedCostUsd: accounted.estimatedCostUsd,
      };
    }
    if (failure?.kind === "cancelled") event.outcome = "stream_cancelled";
    else if (failure && this.chunkCount > 0 && event.outcome === "input_blocked") event.outcome = "output_blocked";
    else if (!failure && this.blocked) event.outcome = "output_blocked";
    else if (!failure && this.filterUnavailable) event.outcome = "filter_unavailable";
    else if (!failure && !this.terminal) event.outcome = "stream_incomplete";
    const filters = new Map(this.filters);
    for (const annotation of event.filters) {
      const filter = failure && event.outcome === "output_blocked" ? { ...annotation, source: "completion" as const } : annotation;
      filters.set(JSON.stringify(filter), filter);
    }
    event.filters = [...filters.values()];
    event.filterObserved = event.filters.length > 0;
    if (this.costUnavailable) {
      event.costKnown = false;
      event.estimatedCostUsd = null;
      event.costReason = this.price.status === "unconfigured" ? "rate_unconfigured" : "price_scope_unsupported";
    }
    event = {
      ...event,
      stream: {
        firstChunkMs: this.firstChunkMs, ttftMs: this.ttftMs, durationMs,
        interChunkMeanMs: this.gaps.length ? this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length : null,
        interChunkMaxMs: this.gaps.length ? Math.max(...this.gaps) : null,
        chunkCount: this.chunkCount, contentChunkCount: this.contentChunkCount,
        completed: this.terminal && failure === undefined,
      },
    };
    return event;
  }
}
