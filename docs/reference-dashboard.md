---
title: Public Foundry Monitor integration
description: Configure the MIT-licensed dashboard with strict live telemetry, managed identity, and Azure App Service hosting.
---

## Overview

The hybrid design uses native Azure Monitor Workbook/shared-dashboard resources,
Managed Grafana (owned by the parent deployment), and the **actual**
[ytthuan/FoundryMonitorDashboard](https://github.com/ytthuan/FoundryMonitorDashboard)
React/Fastify application for the custom dashboard. No AKS, agent runtime, inference
proxy, or replacement hand-written frontend is needed.

The application is under `integrations\foundry-dashboard`. Upstream commit:
`2fe7fbe72591589139027fdf77a397ac7740cd00`. MIT license and original copyright
are preserved in `LICENSE`; `UPSTREAM.md` records attribution and local changes.
Upstream README describes upstream behavior, not this integration's source selection.

> [!IMPORTANT]
> Custom Azure App Service hosting is not deployed or verified by this integration.
> The parent reported Microsoft Graph CAE `InteractionRequired` /
> `TokenCreatedWithOutdatedPolicies`. Deployment stays gated on interactive Entra
> reauthentication by an authorized user and verified tenant/user-restricted EasyAuth.
> Prior live-data/startup checks ran locally; they are not Azure-host verification.
> Do not disable authentication or relax Conditional Access to work around this gate.

## Run and build

Use Node **22 or later**, not the machine's older Node 20.

```powershell
Set-Location integrations\foundry-dashboard
npm ci
npm run build
npm run test:integration
$env:DATA_SOURCE = 'live'
$env:LOG_ANALYTICS_WORKSPACE_ID = '<your-workspace-customer-id-guid>'
$env:FOUNDRY_RESOURCE_ID = '/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<openai-account>'
$env:PORT = '8787'
npm run start:azure
```

Open `http://localhost:8787`. The server binds `0.0.0.0`, respects App Service's
`PORT`, and serves compiled Vite assets from `dist` alongside `/api`. Production
must be started with this integration directory as working directory.
For Vite development only: `SERVE_STATIC=false` and `npm run dev`.

| Environment variable | Meaning |
|---|---|
| `DATA_SOURCE` | `live` by default; only other accepted value is explicit `fixture` |
| `LOG_ANALYTICS_WORKSPACE_ID` | Exactly the intended workspace's customer GUID; no subscription discovery/cross-workspace queries |
| `FOUNDRY_RESOURCE_ID` | Exactly the intended OpenAI account ARM ID; not a Foundry project/AIServices discovery ID |
| `AZURE_OPENAI_RESOURCE_ID` | Optional alias for `FOUNDRY_RESOURCE_ID`; conflicting values fail startup |
| `APPINSIGHTS_RESOURCE_ID`, `AZURE_SUBSCRIPTION_ID` | Accepted shared deployment settings; not used for telemetry discovery or billing queries |
| `NODE_ENV` | Set to `production` for App Service |
| `PORT` | App Service assigned port; local default 8787 |
| `SERVE_STATIC` | Defaults true; false for Vite development only |
| `ALLOWED_ORIGIN` | Optional dev CORS origin; production is same-origin |
| `AZURE_CLIENT_ID` | Optional **existing** user-assigned managed identity client ID |

Set only the intended workspace/account in App Service application settings.
Do not commit a populated `.env`, credentials, resource IDs, or telemetry exports.
DefaultAzureCredential runs **on the server only**, using App Service managed
identity in Azure or an existing developer sign-in locally. The browser never
receives access tokens or custom credentials. The existing host identity needs
Log Analytics Reader on the intended workspace and Monitoring Reader on the
intended OpenAI account. This integration does not create identities or RBAC.
App Service EasyAuth must enforce the intended tenant and explicitly allowed user
before exposing operational data. This application does not add an authentication
library or create identity resources.

`DATA_SOURCE=fixture` is an explicit offline preview; all API metadata/badges say
fixture. Live never changes mode on missing configuration, failed credentials,
partial results, throttling, or other upstream failures. Those return non-2xx
error envelopes with `meta.source=live`, not sample data. `auto` and `mock`
settings are rejected, including legacy upstream Docker defaults.

## Telemetry semantics

Only workspace **AppDependencies** records with
`Properties["telemetry.kind"] == "aoai.request"` and
`Properties["demo.mode"] == "live"` are read in live mode.
Workspace fixture traces and other instrumentation are excluded.

Safe projection includes the model (`gen_ai.request.model`), `aoai.deployment`,
model version/SKU, `aoai.prompt_tokens`, `aoai.completion_tokens`,
`aoai.cached_tokens`, `aoai.outcome`, `aoai.status_code`, latency, streaming,
TTFT, inter-chunk mean, completion flag, price status, and nullable recorded
`aoai.estimated_cost_usd`. No raw prompts, generated text, filters, or raw error
bodies are queried or returned, even if the legacy `includeRaw` flag is supplied.
Identifiers/outcome categories are allowlisted before being returned.

Missing usage/cost stays **null**, including incomplete aggregate totals.
The UI shows `—` or chart gaps, never fabricated zeros. Error rate is
non-success outcomes divided by observed calls; empty windows have null rates.
Latency quantiles use observed samples. The bounded query rejects windows
over 50,000 records and partial Azure responses instead of truncating totals.
Choose a smaller range for larger loads. API envelopes are cached for 20 seconds.
Agents are not applicable, hidden from navigation, and agent endpoints report N/A.

Recorded ledger estimates remain unchanged. A **separate** request column can
reprice known usage against the verified **2026-10-14 current retail snapshot**:

| Model | Version | Input / cached / output USD per million |
|---|---|---|
| gpt-6-luna | 2026-09-22 | 0.1 / 0.01 / 0.5 |
| gpt-5.6-luna | 2026-07-09 | 0.2 / 0.02 / 1.2 |
| gpt-5.6-terra | 2026-07-09 | 2 / 0.2 / 12 |

Repricing requires exact model/version, GlobalStandard SKU, prompt count ≤4096,
and known prompt/completion/cache counts. Otherwise it is null. The formula is
`((prompt-cached)*input + cached*cachedInput + completion*output)/1e6`.
An explicit `aoai.cost_reason=price_scope_unsupported` always blocks snapshot
repricing, including unsupported cache-creation/write billing. Legacy records
without this reason remain eligible; unconfigured ledger rates are not replaced.
The immutable snapshot is explicitly not an invoice or historical billing rate,
and is not silently substituted for a missing recorded estimate. Prices originate
from the root verified price cards and [Azure OpenAI retail pricing](https://azure.microsoft.com/pricing/details/azure-openai/).
No Cost Management/invoice query or unconfigured-price zero fallback is used.
The integration vendors an exact copy of the root `config/model-prices.json` and
validates it at startup. It is emitted as `build/config/model-prices.json` and
included in the ZIP. Unverified, duplicate, missing, or invalid cards fail closed;
the upstream app's approximate default price table is not used or packaged.

Native metrics use the configured OpenAI **accounts ARM metrics endpoint**,
`Microsoft.CognitiveServices/accounts`, API version `2018-01-01`:
`AzureOpenAIRequests`, `ProcessedPromptTokens`, and `GeneratedTokens`.
Rows group on `ModelDeploymentName` (deployment, not model).
Native cached tokens, estimates, and error rate remain null rather than inferred.
Instrumented model/agent/operation filters are rejected for native account metrics;
clear filters on Platform Usage. Native counters and instrumented request records
are separate data planes and may differ due to time buckets/ingestion coverage.
See [official metric reference](https://learn.microsoft.com/azure/foundry/openai/monitor-openai-reference).

## Routes and expected responses

UI routes: `/`, `/platform`, `/tokenomics`, `/models`, `/cost`, `/operations`,
`/requests`; legacy `/agents` shows not applicable.

GET APIs retain the upstream envelopes and range/table query parameters:
`/api/health`, `/api/meta`, `/api/overview`, `/api/tokens/series`,
`/api/tokens/by-model`, `/api/models`, `/api/operations`, `/api/cost/series`,
`/api/cost/by-model`, `/api/latency/series`, `/api/operations/errors/series`,
`/api/operations/recent-errors`, `/api/platform/usage`,
`/api/platform/usage/series`, `/api/platform/by-model`, `/api/pricing`.

Additional `/api/requests` returns safe paginated request rows including original
nullable `estimatedCostUsd`, `priceStatus`, and separate `currentRetailCostUsd` /
`currentRetailPriceBasis`. `/api/streaming` returns observed calls, completed /
incomplete / unknown completion counts, p50/p95 TTFT, inter-chunk-mean p50, and
known sample counts. Existing agent APIs return empty N/A responses.

Success: `{ meta: { source: "live", status: "ok" | "empty", warnings: [...] }, data: ... }`.
Failure: non-2xx `{ meta: { source: "live", status: "error" }, error: { code, message } }`,
without a `data` field or raw Azure error bodies. Missing live configuration is 503;
upstream query failures are 502; invalid queries are 400.

## App Service ZIP

Run `pwsh -File scripts\package.ps1` after a successful
build. Output: `artifacts\foundry-dashboard.zip` with application files **at ZIP
root**, not nested inside a directory:

```text
package.json, package-lock.json
LICENSE, UPSTREAM.md, INTEGRATION.md
dist\                   # compiled frontend
build\server\           # compiled Node server (startup build/server/index.js)
build\shared\           # compiled API contracts
build\config\model-prices.json  # exact root verified snapshot with provenance
```

No `.git`, `.env`, private exports, Windows `node_modules`, upstream screenshots,
or tests are packaged. The ZIP manifest contains only the startup script and no
dev dependencies/build script; server and UI are already compiled.
Configure App Service Linux **Node 22+**, ZIP dependency installation
(`SCM_DO_BUILD_DURING_DEPLOYMENT=true`), and startup **`npm run start:azure`**. Both
`start` and `start:azure` are included in the ZIP manifest. Linux/Oryx
installs the production dependencies (`npm ci --omit=dev` also works); no frontend
compiler is needed on the host. Do not reuse Windows native dependencies on Linux
or enable run-from-package without a Linux dependency install.
No Azure deployment is performed by the packaging script.
ZIP entry ordering and timestamps are fixed; repeated packaging of identical
compiled inputs produces the same SHA-256. Rebuilds use `npm ci` and the committed
lockfile, with Node 22+ and PowerShell 7. The ZIP deliberately excludes unused
upstream Azure/mock adapters and approximate app-local pricing code.

## Resume deployment after authorized interactive reauthentication

These commands are a supervised handoff, not executed by this integration.
Use placeholders for the intended existing App Service, tenant, and allowed user.
First have the authorized user complete interactive sign-in and any Conditional
Access/MFA challenge. If Microsoft Graph still reports outdated policies or
`InteractionRequired`, stop and resolve that with the tenant administrator.
Do not switch tenants, accounts, or authentication methods to evade the policy.

```powershell
$ErrorActionPreference = 'Stop'
$TenantId = '<tenant-guid>'
$SubscriptionId = '<subscription-guid>'
$ResourceGroup = '<resource-group>'
$WebApp = '<existing-node22-app-service>'
$AllowedUserObjectId = '<explicitly-allowed-Entra-user-object-id>'
$LawCustomerId = '<intended-workspace-customer-guid>'
$OpenAIResourceId = '/subscriptions/<subscription-guid>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<openai-account>'
$Zip = (Resolve-Path 'integrations\foundry-dashboard\artifacts\foundry-dashboard.zip').Path

# Run only with the authorized user present.
az login --tenant $TenantId
if ($LASTEXITCODE -ne 0) { throw 'Interactive Entra sign-in is required; do not continue.' }
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Cannot select the intended subscription.' }

# The parent must finish its Entra/EasyAuth configuration first.
$authJson = az webapp auth show --resource-group $ResourceGroup --name $WebApp --output json
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify EasyAuth; deployment remains gated.' }
$auth = $authJson | ConvertFrom-Json
$settings = if ($auth.properties) { $auth.properties } else { $auth }
$aad = $settings.identityProviders.azureActiveDirectory
$identities = @($aad.validation.defaultAuthorizationPolicy.allowedPrincipals.identities)
$groups = @($aad.validation.defaultAuthorizationPolicy.allowedPrincipals.groups | Where-Object { $_ })
$issuer = [string]$aad.registration.openIdIssuer
$issuerUri = [uri]$issuer
if ($settings.platform.enabled -ne $true -or
    $settings.globalValidation.requireAuthentication -ne $true -or
    $aad.enabled -ne $true -or
    $issuerUri.Scheme -ne 'https' -or $issuerUri.Host -ne 'login.microsoftonline.com' -or
    $issuer -notmatch ('/' + [regex]::Escape($TenantId) + '(/v2\.0)?/?$') -or
    $identities.Count -ne 1 -or $identities[0] -ne $AllowedUserObjectId -or
    $groups.Count -ne 0 -or @($settings.globalValidation.excludedPaths | Where-Object { $_ }).Count -ne 0) {
    throw 'EasyAuth tenant/user enforcement is not verified. Do not upload or expose this app.'
}

# Preserve auth settings. Configure only the existing host/runtime and data sources.
az webapp config set --resource-group $ResourceGroup --name $WebApp --startup-file 'npm run start:azure' --output none
if ($LASTEXITCODE -ne 0) { throw 'Cannot configure startup.' }
az webapp config appsettings set --resource-group $ResourceGroup --name $WebApp --settings NODE_ENV=production DATA_SOURCE=live SERVE_STATIC=true SCM_DO_BUILD_DURING_DEPLOYMENT=true LOG_ANALYTICS_WORKSPACE_ID=$LawCustomerId FOUNDRY_RESOURCE_ID=$OpenAIResourceId --output none
if ($LASTEXITCODE -ne 0) { throw 'Cannot configure intended live sources.' }
az webapp deploy --resource-group $ResourceGroup --name $WebApp --src-path $Zip --type zip
if ($LASTEXITCODE -ne 0) { throw 'ZIP deployment failed; do not claim hosted verification.' }
az webapp log tail --resource-group $ResourceGroup --name $WebApp
```

The existing host must already use Linux Node 22+ and its managed identity must
have the parent-provisioned reader roles. The commands do not create identity,
app-registration, RBAC, Grafana, or Workbook resources, or change EasyAuth.
Do not paste tokens or log sensitive app-setting values.

After deployment, verification must occur through the protected Azure URL:
anonymous access must challenge or deny (302/401), a different user must be denied
(403), and only the explicitly allowed user may view the UI and `/api` responses.
The signed-in user must confirm `meta.source=live` and the intended telemetry on
the hosted `/api/overview`, `/api/requests`, `/api/streaming`, and native Platform
view. Use the browser's authenticated session; never expose a token in frontend
configuration. Until these checks pass, retain `azureHostedVerified=false`.
See [App Service Entra authorization checks](https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad#authorize-requests).
