# Architecture Decision Records

This directory is the canonical home for FoundryMonitorDashboard's architecture
decision records (ADRs) and the threat model. It is **additive** — existing ADRs
are superseded, never silently rewritten.

## Format

Each ADR follows: **Title · Status · Context · Decision · Consequences ·
Alternatives considered**. Statuses: `Proposed`, `Accepted`, `Superseded by
ADR-XXXX`, `Deprecated`.

## Index

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](./0001-server-tier.md) | Thin server tier — browser never touches Azure | Accepted |
| [ADR-0002](./0002-data-access.md) | Azure data access via Monitor Query SDK + AzureCliCredential | Accepted |
| [ADR-0003](./0003-contracts.md) | Telemetry contract single source of truth (Zod) | Accepted |
| [ADR-0004](./0004-cost-sources.md) | Estimated vs authoritative cost sources | Accepted |
| [ADR-0005](./0005-charting.md) | Charting via Recharts + shadcn chart primitive | Accepted |
| [ADR-0006](./0006-caching.md) | Caching + throttling strategy | Accepted |
| [ADR-0007](./0007-routing.md) | Code-based TanStack Router (not file-based) | Accepted |
| [ADR-0008](./0008-data-source-mode.md) | Live/mock data-source mode + response envelope | Accepted |

## Threat model

See [threat-model.md](./threat-model.md) — an asset/boundary/threat/mitigation
table with concrete, verified status for each item.

## Telemetry assumptions

These ADRs were authored against observed Azure AI Foundry telemetry. Configure
your own resources via `.env` (see `.env.example`); the shapes below are what the
dashboard expects:

- An AI Foundry (AIServices) resource paired with an Application Insights
  component.
- gen_ai telemetry is present, primarily in the App Insights **`dependencies`**
  table, following OpenTelemetry GenAI semantic conventions in
  `customDimensions`.
- Operations observed: `chat`, `invoke_agent`, `execute_tool`. Token counts
  (input/output/cached) appear **only on `chat`**. Latency from the native
  `duration` (ms) column. `success` / `resultCode` columns are present.
- **`gen_ai.cost` is ABSENT.** Estimated cost must be token-derived via a
  configurable per-model price table (see ADR-0004).
- Raw content (`gen_ai.input.messages`, `gen_ai.output.messages`, tool call
  args/results) is present and is **PII** — aggregated-only, gated off by
  default (see ADR-0003, ADR-0004, threat model).
