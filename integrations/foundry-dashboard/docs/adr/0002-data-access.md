# ADR-0002 — Azure data access (Monitor Query SDK + AzureCliCredential)

**Status:** Accepted

## Context

The server (ADR-0001) must query Application Insights for GenAI telemetry and
Azure Cost Management for billing. Verified probing confirms the telemetry lives
in the App Insights `dependencies` table under OpenTelemetry GenAI semantic
conventions, queryable via KQL/Logs.

Developers already authenticate with `az login`. We want to reuse that session
rather than provision a service principal or embed secrets. We also need
resilience: a typed SDK path plus a fallback, and graceful handling of
credential expiry.

## Decision

- Use **`@azure/monitor-query`** (`LogsQueryClient`) for telemetry and the Cost
  Management client/REST for billing, authenticated with
  **`@azure/identity` `AzureCliCredential`** — reusing the developer's `az login`
  session. No service-principal secrets, no keys, no connection strings in code
  or `.env`.
- Keep **`az monitor app-insights query`** (shell-out) as a documented fallback
  path for environments where the SDK credential misbehaves.
- The target resource is selected by configuration (`APP_INSIGHTS_RESOURCE_ID`,
  subscription scope) — see ADR-0008 and the threat model. Resource IDs are
  config, not secrets; **connection strings / instrumentation keys are secrets
  and must never be used or committed.**
- **Credential failure is a first-class state, not a 500.** When the credential
  is missing/expired or `az` is not logged in, the server returns a structured
  `error` envelope (ADR-0008) with an actionable message — e.g. *"Azure
  credential unavailable — run `az login`"* — never a stack trace or token.

## Consequences

- Zero long-lived secrets in the repo; auth piggybacks on the dev's existing
  Azure session.
- Token lifetime is handled by `AzureCliCredential`; expiry surfaces as an
  actionable, non-fatal error the UI can render.
- Tokens stay server-side and are never logged or serialized to the client
  (threat model: Azure token leak).
- A second (CLI) code path exists; it must stay behind the same contract
  validation (ADR-0003) so live/fallback/mock are interchangeable.

## Alternatives considered

- **Service principal + client secret** — rejected: introduces a long-lived
  secret to store and rotate; unnecessary for a local dev tool.
- **Instrumentation key / connection string direct ingestion read** — rejected:
  keys are secrets; KQL via Logs is richer and aligns with Cost Management auth.
- **Shell out to `az` as the primary path** — rejected as primary (brittle
  parsing, process overhead) but retained as fallback.
