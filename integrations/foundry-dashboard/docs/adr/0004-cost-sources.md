# ADR-0004 — Estimated vs authoritative cost sources

**Status:** Accepted

## Context

Cost is a headline metric for this dashboard. Verified probing established a
hard constraint: **`gen_ai.cost` is ABSENT** from the telemetry. The only
near-real-time signal is **token counts** (input/output/cached), and those
appear **only on the `chat` operation** — `invoke_agent` and `execute_tool`
carry no tokens. Authoritative spend is available from **Azure Cost Management**,
but it is delayed (hours) and reflects billed reality, not per-request attribution.

Conflating these two would produce a number that is neither timely-accurate nor
billing-accurate, and would erode trust the moment a user reconciles it against
their Azure invoice.

## Decision

Expose **two distinct, explicitly labeled cost sources** that are **never merged
silently**:

1. **Estimated cost** — derived as `tokens × per-model unit price` from a
   **configurable per-model price table** (server-side config). Available only
   where token data exists (`chat`). Near-real-time but approximate; depends on
   the price table being current.
2. **Billed cost** — from **Azure Cost Management**, scoped to the configured
   subscription. Authoritative but delayed and coarser-grained.

The telemetry contract (ADR-0003) carries explicit provenance flags on every
cost-bearing DTO:

- `source: "estimated" | "billed"`
- `costAvailable: boolean` (false where no tokens / no price entry / op has no
  tokens)
- `priceSource` (identifier/version of the price table used for estimates)

The UI must render the source label next to every cost figure and must visually
distinguish estimated from billed. Where a model has no price-table entry,
`costAvailable=false` and the UI shows "price unknown", never `$0`.

## Consequences

- Users always know whether a number is an estimate or a bill — trust preserved.
- The price table is the maintenance surface for estimate accuracy; it is
  config, owned server-side, and versioned via `priceSource`.
- Estimated cost is partial by construction (chat-only); aggregates must not
  imply tool/agent operations are free — they're "not token-priced".
- Cost Management exposure is scoped to the configured subscription and
  aggregated (threat model: over-broad billing exposure).

## Alternatives considered

- **Single conflated cost number** — rejected: misleading, unreconcilable
  against invoices.
- **Hardcoded prices in code** — rejected: prices change per model/region;
  belongs in versioned config (`priceSource`).
- **Billed-only** — rejected: too delayed for an interactive monitoring tool.
- **Estimated-only** — rejected: no authoritative ground truth; can't reconcile.
