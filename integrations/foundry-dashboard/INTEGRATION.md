---
title: Workspace API-only integration
description: Run the upstream Foundry Monitor dashboard against an explicitly configured Azure workspace and OpenAI account.
---

## Overview

See [integration instructions](../../docs/reference-dashboard.md). The original MIT-licensed
dashboard is adapted here, not reimplemented. Source and commit are recorded in `UPSTREAM.md`.

Use Node **22+**. Run `npm ci`, `npm run build`, `npm run test:integration`, then `npm run start:azure`.
The production server serves `dist` and `/api` on `0.0.0.0:$PORT` (8787 by default).
Set `SERVE_STATIC=false` only for Vite development. Never deploy the upstream mock Docker settings.

Required live settings: `DATA_SOURCE=live` (default), `LOG_ANALYTICS_WORKSPACE_ID`,
`FOUNDRY_RESOURCE_ID` (OpenAI account ARM ID; `AZURE_OPENAI_RESOURCE_ID` remains an alias).
Conflicting account IDs are rejected. Authentication is server-side `DefaultAzureCredential`, using
App Service managed identity in Azure or an existing developer login locally.
`AZURE_CLIENT_ID` is optional for an existing user-assigned managed identity.
There are no API keys, frontend credentials, automatic Azure discovery, or mock fallback.
`APPINSIGHTS_RESOURCE_ID` and `AZURE_SUBSCRIPTION_ID` may be supplied by the shared deployment
but do not replace the explicit workspace/account sources. EasyAuth protects access at the host;
the application does not introduce an authentication library or create identities.
An explicit `DATA_SOURCE=fixture` is the only offline mode; every response is marked `fixture`.

Missing telemetry values stay null, charts show gaps, and unavailable aggregates show `—`.
Ledger estimates remain exactly as recorded; current retail snapshot repricing is a separate
request-ledger column, valid only for the exact model/version/SKU and short-context tier.
Neither is an invoice. No Cost Management or agent queries are made.

The price snapshot is an exact data copy of the root verified `config/model-prices.json`.
The server validates its verified status and reads the compiled bundled JSON, not upstream
app-local pricing defaults. Missing/invalid snapshots fail startup rather than invent rates.

## Deployment gate

Custom Azure hosting is **not verified**. The parent encountered Microsoft Graph
`InteractionRequired` / `TokenCreatedWithOutdatedPolicies`; an authorized user must complete
interactive Entra reauthentication and the parent EasyAuth configuration before deployment.
Do not disable authentication, broaden tenant/user access, or publish an unauthenticated app.
Prior startup checks were local Node processes reading Azure, not deployed-host verification.
The native Workbook/Portal and Managed Grafana remain the parent deployment's responsibility.
