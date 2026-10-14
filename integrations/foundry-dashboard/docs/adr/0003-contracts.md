# ADR-0003 — Telemetry contract is the single source of truth (Zod)

**Status:** Accepted

## Context

Client and server both need to agree on the shape of telemetry DTOs and query
parameters (time range, granularity, resource/subscription scope, filters). If
each side redefines these types, they drift — a classic source of silent bugs,
especially as the Azure response shape (raw `dependencies` rows with
`customDimensions`) is messy and must be normalized.

We also need **runtime** validation, not just compile-time types: the server
must validate untrusted Azure responses at the boundary before normalizing
them, and tests must prove that mock data conforms to the same shape as live
data.

## Decision

- Telemetry DTOs and query params are defined **once** in `shared/contracts/**`,
  owned solely by `@azure-data`.
- Contracts are authored as **Zod schemas with inferred TypeScript types**
  (`z.infer<...>`), so a single definition yields both a runtime validator and a
  static type.
- The **server validates Azure (and CLI-fallback and mock) responses against the
  contract at the boundary**, then returns only contract-conformant data. Parse
  failures become structured `warnings[]` or an `error` envelope (ADR-0008),
  never unvalidated passthrough.
- The **client imports contract types and never redefines them.** Client/UI-only
  types live in `src/types/**` and must not duplicate telemetry shapes.
- **Contract tests** (owned by `@tester`) assert that mock fixtures parse
  against the same schema used for live responses, guaranteeing live/mock parity.

## Consequences

- No DTO drift between tiers; one owner, one definition.
- Untrusted Azure payloads are validated before use — defense in depth against
  malformed/unexpected fields and a natural place to enforce the
  aggregates-only / PII-gating posture (threat model).
- Zod adds a small runtime cost at the boundary — acceptable and bounded by the
  short-TTL cache (ADR-0006).
- The contract carries cost-source flags (`source`, `costAvailable`,
  `priceSource`) per ADR-0004 and envelope `meta` per ADR-0008.

## Alternatives considered

- **Hand-written TS interfaces shared via a package** — rejected: compile-time
  only; no runtime validation of Azure responses.
- **Separate client/server types** — rejected: guarantees drift.
- **io-ts / Valibot / TypeBox** — viable; Zod chosen for ergonomics, ecosystem
  familiarity, and clean `z.infer` type inference.
