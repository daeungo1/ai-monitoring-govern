# Threat Model — FoundryMonitorDashboard

**Status:** Accepted. This is the canonical threat model for the project.

## Scope & trust boundaries

- **Browser (untrusted runtime)** ⇄ \*\*local API (`127.0.0.1` Fastify, trusted)\*\*
  ⇄ **Azure (App Insights Logs + Cost Management)**.
- Per ADR-0001, the browser never holds Azure credentials and never constructs
  KQL. The server is the only component that authenticates to and queries Azure.
- Verified context drives several mitigations: telemetry carries \*\*raw message
  content (PII)\*\* in `customDimensions`; **`gen_ai.cost` is absent**; resource
  IDs are configuration.

## Threats, mitigations, status

| # | Asset | Boundary | Threat | Mitigation (concrete) | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Azure access token (`az`/`AzureCliCredential` session) | API ↔ Azure | Token leak via logs, error bodies, or serialization to client | Tokens live server-side only; never logged or serialized; structured logging redacts auth; auth failure → actionable "run `az login`" error envelope, not a 500/stack (ADR-0002, ADR-0008) | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — `AzureCliCredential` is server-only (`server/adapters/azure.ts:122`); `Fastify({ logger:false })` (`server/index.ts:123`); token object never serialized into any response/cache; unknown errors collapse to generic "Upstream telemetry query failed." (`server/index.ts:147`); auth → `auth`/401 "run `az login`" (`server/adapters/azure.ts:396`, `server/index.ts:148`) |
| T2 | Telemetry content (raw prompts/responses, tool args/results = **PII**) | API ↔ browser | Sensitive message text exposed in the UI / API responses | **Aggregates by default.** Raw content is **gated behind an explicit flag, off by default**; server validates/normalizes at the contract boundary (ADR-0003) and does not include raw message fields unless the gate is on; PII never enters cache keys or logs | `@reviewer` + `@azure-data` | **VERIFIED (Wave 5)** — `message` is `.optional()` and absent from default shape (`shared/contracts/index.ts:384`); double gate: client `includeRaw===true` **AND** `ALLOW_RAW_CONTENT==="true"` (`server/index.ts:86`), default `.env`=false; client always sends `includeRaw:false` (`src/features/operations/operations-view.tsx`); cache key only stores the boolean `raw` flag, not content (`server/index.ts:135`). Note: even when enabled, the raw projection is `tostring(name)` (span name), **not** `gen_ai.input.messages`/`output.messages` — safer than spec (see findings L3) |
| T3 | KQL query string | browser → API → Azure | Injection via user-controlled filters (model, agent, operation, range) | **Allow-list enums + runtime-discovered model/agent sets**; values validated against the contract (ADR-0003) before use; queries built with **parameters / validated bindings, never string concatenation/escaping**; time range/granularity from a bounded enum | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — filter arrays serialized via `JSON.stringify` into a single `dynamic(...)` literal (`server/adapters/azure.ts:78-81`), so values cannot break out; `operation` is enum-bound (`shared/contracts/index.ts:22,62-74`); `model`/`agent` cross-checked against runtime-discovered `make_set` allow-lists, unknown → 400 (`validateFilters` `server/adapters/azure.ts:426-434`); time bounds are `Date→toISOString()` (`server/time.ts:20-27`); `page`/`pageSize` are `z.coerce.number().int()` bounded (`shared/contracts/index.ts:84-90`). No raw client string is concatenated into KQL |
| T4 | Subscription / resource IDs | config | Hardcoded IDs or accidental commit of secrets | IDs are **config via env** (`APP_INSIGHTS_RESOURCE_ID`, subscription); `.env` is **gitignored**; `.env.example` holds **names only**. NOTE: resource/subscription IDs are *config, not secrets* — but **connection strings / instrumentation keys / SP secrets ARE secrets and must never be used or committed** (ADR-0002) | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — `.gitignore` excludes `.env` + `.env.*` with `!.env.example` allow; `.env` holds only subscription/resource/app IDs (config) + `ALLOW_RAW_CONTENT=false`; `.env.example` is names-only; grep found **no** instrumentation keys / connection strings / client secrets / hardcoded IDs in `server/**`/`src/**` (all read from `process.env`) |
| T5 | Local API server | host network | Bound to all interfaces / overly-open CORS allowing other origins or LAN access | Server **binds `127.0.0.1`** only; **CORS allow-list = Vite dev origin only**; no `0.0.0.0`, no wildcard CORS (ADR-0001) | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — `server.listen({ host:"127.0.0.1", port })` hardcoded (`server/index.ts:179`); CORS `origin` = exact `ALLOWED_ORIGIN` default `http://127.0.0.1:5173`, `methods:["GET"]`, no wildcard (`server/index.ts:37,125`); Vite dev binds `127.0.0.1` (`vite.config.ts:16`) |
| T6 | Azure Monitor / Cost Management quotas & billing | API ↔ Azure | Cost amplification / throttling (429s) from redundant or unbounded queries | Short-TTL server cache keyed by query+range+granularity+filters; **single-flight coalescing** of identical concurrent queries; honor \\*\\*`Retry-After`\\*\\* + **exponential backoff w/ jitter**; **bounded result sets/granularity** (ADR-0006) | `@azure-data` | **VERIFIED (Wave 5)** — 20 s TTL cache + in-flight coalescing keyed on `{source,url,query,raw}` (`server/cache.ts`, `server/index.ts:135`); `withBackoff` 3-try exponential + `Retry-After` honored (`server/adapters/azure.ts:63-76`, `server/errors.ts:24-31`); bounds: `pageSize≤200`, `topN≤100`, `make_set(...,200)`, `serverTimeoutInSeconds:60` |
| T7 | Cost Management data | API ↔ browser | Over-broad billing exposure beyond intended scope | Scoped to the **configured subscription**; aggregate views; estimated vs billed never conflated and each labeled with `source` (ADR-0004) | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — Cost Mgmt scoped to `/subscriptions/${subscriptionId}` MonthToDate aggregate only (`server/adapters/azure.ts:439-453`); `estCost` (token×price) vs `billedCostMtd` kept distinct in the contract; `meta.costAvailable`+`meta.priceSource` label provenance; CM failure degrades gracefully (warning + `available:false`, estimate still returned) (`server/adapters/azure.ts:458-460`) |
| T8 | Dependencies (TanStack, shadcn, Recharts, Azure SDK, Fastify, Zod) | supply chain | Malicious / typosquatted / vulnerable package | New deps **justified, pinned, from trusted sources**; `npm audit` clean or triaged; `@orchestrator` is sole installer (serialized) to avoid lockfile clobber; dependency review on additions (ADR-0003 picks Zod from a known source) | `@reviewer` + `@tester` | **CHECKED — 1 cleanup item** — `npm audit --omit=dev` = **0 vulnerabilities**; all deps from trusted scopes. GAP: `@azure/arm-costmanagement@1.0.0-beta.1` is declared but **unused** (cost uses `az costmanagement` CLI) — remove (finding M1). Deprecation notes: Recharts 2.x (maintenance), `@azure/monitor-query` (superseded by `@azure/monitor-query-logs`) — non-blocking (finding L1) |
| T9 | Data provenance / freshness | API ↔ browser | Silent staleness or silent partial failure misleading the user | Response envelope carries `meta.source` (live/mock), `meta.dataAsOf`, `meta.granularityUsed`, `meta.warnings[]`; explicit ok/empty/error states (ADR-0008) | `@azure-data` + `@reviewer` | **VERIFIED (Wave 5)** — every endpoint wraps via `envelope()`/`ApiResponseSchema` incl. `/api/health` + `/api/pricing` (`server/index.ts:97-114,152-177`); `statusFromData` yields ok/empty, errors use `errorEnvelope` with full `meta` (`server/index.ts:90-119`); `meta.source` distinguishes live/mock |

## Residual risks / notes

- **Price-table accuracy (T7-adjacent):** estimated cost (ADR-0004) is only as
  correct as the configurable per-model price table; staleness yields wrong
  *estimates*, never wrong *bills*. `priceSource` exposes which table was used.
- **Raw-content gate operational risk (T2):** the off-by-default gate protects
  PII, but if an operator enables it, PII may reach the browser/logs by design.
  The gate must remain explicit, narrow, and never the default; reviewer checks
  it is not silently flipped.
- **Local-tool assumption (T5):** mitigations assume a single-developer
  local-first deployment. Any future networked/hosted deployment \*\*invalidates
  the `127.0.0.1` + CLI-credential model\*\* and requires a new ADR + threat-model
  revision (e.g. managed identity, authn/z on the API).
- **CLI fallback path (T1/T3):** the `az monitor app-insights query` fallback
  must apply the same redaction and allow-list discipline as the SDK path.

## Verification hooks (for Wave 5 review)

- grep server logs/handlers for token/credential serialization (T1).
- Confirm no raw `gen_ai.input.messages` / `gen_ai.output.messages` in default
  response shapes or cache keys (T2).
- Confirm KQL is built from validated/allow-listed values, no string concat (T3).
- Confirm `.gitignore` covers `.env*` (except `.env.example`); inspect
  `.env.example` for names-only (T4).
- Confirm Fastify `host: 127.0.0.1` and CORS origin allow-list (T5).
- Confirm cache key tuple + backoff/`Retry-After` + result caps (T6).
- `npm audit` evidence for any new dependency (T8).
- Confirm every endpoint returns the `meta` envelope + ok/empty/error (T9).

## Final review findings (Wave 5 — 2026, `@reviewer`)

**Verdict: GO for local single-operator use.** No Critical or High findings. All
nine threat-model controls (T1–T9) verified against code with file:line evidence
above. `npm audit --omit=dev` = 0 vulnerabilities. Remaining items are hygiene /
non-blocking; remediation is the orchestrator's to route (reviewer is read-only
on code).

| ID | Sev | Problem | Impact | Location | Fix |
| --- | --- | --- | --- | --- | --- |
| M1 | Medium | `@azure/arm-costmanagement@1.0.0-beta.1` declared in `dependencies` but **unused** (billed cost uses the `az costmanagement` CLI via `execFile`). | Unnecessary supply-chain surface; a *beta* SDK adds instability with no benefit. | `package.json` deps; no import in `server/**`/`src/**` (grep: 0 hits) | `@orchestrator`: `npm rm @azure/arm-costmanagement` (or, if SDK adoption is intended, replace the CLI shell-out and pin a stable release). |
| L1 | Low | Deprecated/maintenance deps: `@azure/monitor-query@1.3.3` (superseded by `@azure/monitor-query-logs`) and Recharts 2.x. | None today; future EOL/maintenance risk. | `package.json`; `server/adapters/azure.ts:4` | Track for a future upgrade ADR; no action required now. |
| L2 | Low | `.env` declares vars the server never reads (`HOST`, `APP_INSIGHTS_APP_ID`, `AZURE_RESOURCE_GROUP`) while the bind host is hardcoded to `127.0.0.1`; `.env.example` omits `HOST` and includes `ALLOWED_ORIGIN` not present in `.env`. | Dead/misleading config — an operator setting `HOST=0.0.0.0` would wrongly expect it to take effect (it is safely ignored). | `.env`, `server/.env.example`, `server/index.ts:179` | `@azure-data`: align `.env.example` with the vars actually consumed; drop unused keys or wire them. Hardcoded `127.0.0.1` bind is correct — keep it. |
| L3 | Low (info) | The PII raw-content gate, when enabled, projects `message=tostring(name)` (the dependency/span name) — **not** the actual `gen_ai.input.messages`/`output.messages`/tool args. | Safer than spec (real PII is never returned), but the feature is misleading: enabling `ALLOW_RAW_CONTENT` does not surface the content an operator might expect. | `server/adapters/azure.ts:354,362` | `@azure-data`: either document that "raw" = span name only, or (if true raw content is desired) project the gen\\_ai message fields — which would then make the off-by-default gate genuinely load-bearing. No security action required. |
| L4 | Low (info) | 400 validation errors reflect the offending filter value back (`Unknown model filter: <value>`). | Negligible — JSON API, echoes the caller's own input; no XSS sink. | `server/adapters/azure.ts:431,433` | Accept as-is. |

**Architecture boundaries — PASS.** Client imports telemetry types only from
`@shared/contracts` (no DTO duplication in `src/lib`/`src/features`; `src/types`
holds UI-only params and explicitly defers DTOs to contracts). The only `fetch`
lives in `src/lib/api/client.ts`; components consume data exclusively via
TanStack Query hooks. No `@azure/*` import reaches `src/**`. `shared/contracts`
remains the single source of truth.

**Residual risk:** unchanged from the notes above — price-table staleness affects
*estimates only*; the raw-content gate must remain off by default (verified);
the `127.0.0.1` + CLI-credential model is valid only for local single-operator
use and a hosted deployment would require a new ADR + threat-model revision.

---

## Platform-metrics enhancement review — 2026-06-11

Focused security + architecture review of the **additive** authoritative
platform-metrics surface (Azure Monitor `MetricsQueryClient` on the Foundry
resource): adapter `server/adapters/platform.ts`, pricing additions
`server/pricing.ts`, contracts `shared/contracts/index.ts`, routes
`server/index.ts`, and the `/platform` client view/hooks. Prior full review
returned GO; this covers only the new/changed surface.

### Verdict: **GO** — no Critical/High findings.

**1. Metrics filter injection — PASS (no finding).** User-supplied `model`
filters **never** reach the Azure Monitor `filter` expression. The only filter
strings passed to `queryResource` are static literals — `"ModelName eq '*'"`,
`"StatusCode eq '*'"`, or `undefined` (`platform.ts:112,113,130,156`). Model
filtering is performed *post-query* in `matchesModel()` (`platform.ts:69-73`)
against a `Set` of allowed values matched on returned metadata — an allow-set
comparison, not string interpolation. `validateDimensions: true` is also set
(`platform.ts:215`) as defence in depth. No injection vector exists.

**2. Auth / exposure — PASS.** Same server-side `AzureCliCredential`
(`platform.ts:102`); token from `getToken(...management.azure.com...)` is
awaited and discarded, never stored or logged; Fastify `logger:false`.
`FOUNDRY_RESOURCE_ID` is read from env and threaded as a constructor arg
(`index.ts:70`), not hardcoded; `resourceId` (config, not a secret) is the only
value passed to `queryResource` — no SSRF (not user-controlled). `.env` is
gitignored; `.env.example` lists `FOUNDRY_RESOURCE_ID=` (name only).

**3. PII — PASS.** All three platform endpoints return aggregate token/request
counts and an error rate only (`PlatformUsageData`,
`PlatformUsageSeriesData`, `PlatformByModelData`). No prompt/response content;
the `ALLOW_RAW_CONTENT` gate applies only to recent-errors, not platform.

**4. Cost integrity — PASS.** \`PRICE\_SOURCE = "estimated · configurable ·
default-2026-03" `is propagated to` meta.priceSource\` and the payloads;
estimates are never conflated with authoritative cost. Longest-prefix matching
is collision-safe: `findPrice` sorts by model-name length **descending**
(`pricing.ts:20-25`), so `gpt-5.4-mini` matches its own row by exact equality
*before* the broader `gpt-5.4` `startsWith("gpt-5.4-")` fallback can fire —
mini/nano cannot be mispriced as the base model. Unknown/image models return
`undefined` → `estimateCost` returns `0` (`pricing.ts:30`); no token cost is
fabricated, documented by `UNKNOWN_MODEL_PRICE_NOTE`.

**5. Architecture — PASS.** New Zod schemas added; `usageSource`
(`MetaSchema:118`) is `.optional()` and spread conditionally in `envelope`
(`index.ts:102`) — additive, non-breaking. Client view imports DTOs from
`@shared/contracts` and fetches solely via `@/lib/queries` hooks
(`usePlatformUsage/Series/ByModel`); no `@azure/*` import reaches `src/**`.
Ownership boundaries respected; contracts remain the single source of truth.

**6. Graceful degradation — PASS.** Missing `FOUNDRY_RESOURCE_ID` → empty
payload + warning, not 500 (`platform.ts:110,128,154`). Metrics RBAC/403/
namespace failure is caught and degrades to `null` → empty payload + warning
(`platform.ts:224-226`). True auth failure (401 or credential/`az login`
keywords) → `ApiError("auth", …, 401)` → handler emits `code:"auth"`
(`platform.ts:221-223`, `index.ts:144-151`). Throttling has bounded
exponential backoff + `Retry-After` (`platform.ts:41-54`).

### Minor / informational (no action required to ship)

- **PL1 (Low).** The auth-classification regex in the `query()` catch
  (`platform.ts:221`) is broad (`/…|login/i`). A non-auth upstream error whose
  message happens to contain "login" would be surfaced as a 401 `auth` error
  instead of degrading to an empty warning. RBAC `403 AuthorizationFailed`
  does *not* match (good — it degrades). Impact is cosmetic (wrong error code,
  still no crash). Recommendation (`@azure-data`): prefer the numeric
  `statusCode === 401` check and narrow the keyword fallback.

**Residual risk:** unchanged from prior notes — price-table values are
estimates only; the `127.0.0.1` + CLI-credential model is valid for local
single-operator use; a hosted deployment requires a new ADR + threat-model
revision.