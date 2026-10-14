# Security Policy

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue:

- Use the repository's **"Report a vulnerability"** option under the **Security** tab (GitHub Private Vulnerability Reporting), or
- Open a minimal issue asking maintainers for a private contact channel (do **not** include exploit details in the public issue).

Please include the affected version/commit, reproduction steps, and impact. We aim to acknowledge reports promptly and will coordinate a fix and disclosure timeline with you.

## Security model & posture

This is a **local-first operator dashboard**. Understand the following before deploying it anywhere other than your own machine:

- **No authentication or authorization.** Every `/api/*` endpoint is open to any client that can reach the port. There are no users, roles, sessions, or API keys.
- **Bind address.** The server binds `127.0.0.1` by default (local-only). The Docker image sets `HOST=0.0.0.0` so the port can be published. **Do not expose the published port to untrusted networks or the public internet.** For remote or shared use, place it behind a reverse proxy that enforces authentication and TLS, or restrict access with a private network / host firewall.
- **Credentials stay server-side.** Azure access uses `AzureCliCredential` on the server (your `az login` session). The browser never receives Azure tokens; the SPA only calls the relative `/api`.
- **No secrets in the repo or image.** Real configuration (resource IDs, subscription) lives only in a local `.env`, which is excluded by both `.gitignore` and `.dockerignore`. Only `.env.example` (variable names, no values) is tracked. **Never commit a real `.env`.**
- **PII gate.** Telemetry may contain prompt/response content. The API returns aggregates only; raw content is gated behind `ALLOW_RAW_CONTENT=true`, which is **off by default**. Leave it off unless you understand the exposure.
- **Input validation.** Query parameters are validated with Zod; KQL filters use allow-listed enums / runtime-discovered value sets and parameterized `dynamic(...)` literals rather than string concatenation.
- **Default data source is mock.** The shipped container serves deterministic sample data and makes no outbound Azure calls unless you configure live mode.

See `docs/adr/threat-model.md` for the detailed asset/boundary/threat/mitigation analysis.

## Dependency advisories

`npm audit` may report advisories in **development-only** dependencies (the Vite/Vitest/esbuild toolchain). These tools are **not** part of the production container (`npm ci --omit=dev`), and the relevant advisories require running a dev/test UI server (e.g. `vitest --ui`) that this project does not use. Production runtime dependencies are kept free of known advisories. Run `npm audit --omit=dev` to check the shipped dependency set.

## Supported versions

This project is pre-1.0; security fixes are applied to the latest `main`. Pin a commit/tag if you need stability.
