# ADR-0001 — Thin server tier (browser never touches Azure)

**Status:** Accepted

## Context

The dashboard reads Azure AI Foundry telemetry from Application Insights and
billing from Azure Cost Management. Both require Azure credentials. The product
is a local-first developer tool (Vite dev client + a small server), authored in
TypeScript.

If the browser called Azure directly it would need to hold tokens (via
device-code or an embedded app registration), exposing credentials to the client
runtime, browser extensions, and our own logs. It would also make Cost
Management — which has no clean browser story — effectively unreachable, and
would push KQL construction into untrusted client code.

## Decision

Introduce a **thin server tier** (Fastify) following a ports-and-adapters shape:

- The browser talks only to a local `/api` surface; it **never** holds Azure
  credentials or constructs KQL.
- The Fastify server binds to **`127.0.0.1`** and is the sole component that
  authenticates to Azure and issues queries.
- In development, Vite proxies `/api` → Fastify. Running two processes is
  accepted; `@orchestrator` (sole writer of root config) owns the `/api` proxy
  and the concurrent dev script so subagents don't clobber it.
- Server "ports" (telemetry query, cost query) have swappable "adapters"
  (Azure live vs deterministic mock — see ADR-0008).

## Consequences

- Credentials, KQL, price tables, and caching all live server-side — a single
  defensible trust boundary (reinforced by the threat model).
- Two dev processes and a proxy hop add minor setup complexity, centralized in
  orchestrator-owned config.
- A clear seam exists for live/mock adapters and contract validation at the
  boundary (ADR-0003, ADR-0008).
- CORS is locked to the Vite origin; the API is not exposed on the network.

## Alternatives considered

- **Client-only with device-code auth** — rejected: puts tokens in the browser,
  no Cost Management path, KQL in untrusted code.
- **TanStack Start / framework server functions** — rejected for now: heavier
  framework commitment than a thin Fastify tier needs; ports-and-adapters keeps
  the Azure boundary explicit and testable.
- **Single Fastify process serving the built client** — viable for production
  packaging later, but the dev experience favors Vite + proxy; revisit if/when a
  deploy target is defined.
