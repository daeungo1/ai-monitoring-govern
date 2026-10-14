# ADR-0008 — Data-source mode (live/mock) + response envelope

**Status:** Accepted

## Context

The dashboard must be useful and testable even when Azure is not reachable: no
`az login`, no configured resource, CI/contract tests, or offline development.
At the same time, when live data *is* available, the UI must clearly convey
freshness, which granularity was actually served, and any partial failures (one
panel's query 429'd while others succeeded). A single opaque JSON array can't
carry that.

Verified context: a real App Insights resource exists, so "live" is a genuine
mode — but the deterministic mock must conform to the same contract (ADR-0003)
so the two are interchangeable.

## Decision

**Adapter selection by configuration.** The server selects its data adapter at
runtime:

- **Live (Azure)** when `APP_INSIGHTS_RESOURCE_ID` is set **and** an Azure
  credential is available (`az` logged in).
- **Mock (deterministic)** otherwise — stable, seeded fixtures conforming to the
  contract.

**Uniform response envelope.** Every `/api` response wraps its payload in an
envelope carrying `meta`:

- `meta.source: "live" | "mock"`
- `meta.dataAsOf` — freshness timestamp (accounts for cache TTL, ADR-0006, and
  Cost Management delay, ADR-0004)
- `meta.granularityUsed` — the granularity actually applied (may differ from
  requested due to caps, ADR-0006)
- `meta.warnings[]` — non-fatal/partial-failure messages

**Three explicit states**, modeled in the contract and rendered distinctly:

- **ok** — data returned (possibly with `warnings[]`).
- **empty** — query valid but no data in range (distinct from error; UI shows an
  empty state, not a failure).
- **error** — including **not-configured** and **auth** (ADR-0002), each with an
  actionable message; never a 500/stack trace, never a leaked token.

## Consequences

- Develop, demo, and run contract tests with zero Azure dependency; mock parity
  is enforced by the shared schema (ADR-0003).
- The UI can always show provenance (live vs mock), freshness, effective
  granularity, and partial degradation — no silent staleness or silent failure.
- `empty` vs `error` separation prevents "no data" from looking like a bug.
- Every endpoint must populate `meta`; enforced by contract + review.

## Alternatives considered

- **Live-only** — rejected: blocks offline dev, demos, and deterministic CI.
- **Build-time mock flag** — rejected: less flexible than runtime config; want a
  single binary that degrades gracefully based on environment.
- **Bare payloads (no envelope)** — rejected: nowhere to express source,
  freshness, effective granularity, or partial failure.
- **HTTP status alone for states** — rejected: `empty` is a 200 with no rows;
  conflating it with errors via status codes loses nuance the UI needs.
