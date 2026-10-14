# ADR-0006 — Caching + throttling strategy

**Status:** Accepted

## Context

Azure Monitor Logs and Cost Management are rate-limited and metered. An
interactive dashboard naturally re-issues similar queries (panel mounts, range
toggles, refocus, multiple panels sharing a range). Without protection this
causes redundant cost, latency, and 429s — a cost-amplification and
availability risk (threat model).

## Decision

Two coordinated layers:

1. **Client (TanStack Query)** — de-dupes in-flight requests, caches by query
   key, and controls refetch/stale behavior so the UI doesn't hammer `/api`.
2. **Server-side short-TTL cache** keyed by **query + time range + granularity +
   filters** (the full parameter tuple). Identical concurrent requests are
   **coalesced** into a single upstream Azure call (single-flight), and results
   are served from cache within the TTL.

Throttling discipline on the server:

- Honor the upstream **`Retry-After`** header on 429 responses.
- Apply **exponential backoff** with jitter on retryable failures.
- **Cap result-set size / enforce bounded granularity** so no query returns an
  unbounded number of rows; oversized requests are narrowed or rejected with a
  `warning` (ADR-0008), never streamed unbounded to the client.

## Consequences

- Fewer upstream calls → lower Azure cost and fewer 429s; snappier UI on repeat
  views.
- Cache TTL is a freshness/cost trade-off; the response envelope's `dataAsOf`
  (ADR-0008) makes staleness explicit to the user.
- Cache key must include **all** parameters that change results (range,
  granularity, filters, source) or it risks serving wrong data — enforced by
  review.
- Backoff can delay error surfacing; bounded by max-retry so credential/auth
  errors still surface promptly (ADR-0002).

## Alternatives considered

- **Manual fetch + ad-hoc dedupe** — rejected: reinvents TanStack Query, error
  prone.
- **No server cache (client cache only)** — rejected: doesn't coalesce across
  panels/clients and doesn't shield Azure from bursts.
- **Long-TTL / persistent cache** — rejected for now: monitoring wants fresh
  data; short TTL + `dataAsOf` is the right default.
