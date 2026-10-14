# Contributing

Thanks for your interest in improving Foundry Monitor Dashboard! This guide covers local setup, the checks we expect to pass, and a few conventions.

## Prerequisites

- **Node.js 22+** and **npm 10+**
- Optional: **Docker** (container workflow), **Azure CLI** (`az`) for live data

## Setup

```bash
npm install
cp .env.example .env   # optional; the app serves mock data with no config
npm run dev            # web on http://127.0.0.1:5173, API on :8787
```

With no Azure configuration the server serves deterministic **mock** data, so you can develop every screen offline. See [README.md](./README.md) for live-data setup.

## Quality gates

Please run all of these before opening a pull request — they must pass:

```bash
npm run typecheck   # client + server TypeScript
npm run lint        # eslint
npm run test        # vitest unit + contract tests
npm run build       # production build
```

End-to-end tests (run against mock data):

```bash
npm run e2e
```

When you change `shared/contracts/**`, keep the contract tests (`tests/contracts`) in sync — they are the single source of truth shared by the client and server.

## Project layout

See the **Project structure** section in [README.md](./README.md). In short: `server/` (Fastify API + adapters), `shared/contracts/` (typed DTOs), `src/` (React SPA: `routes/`, `features/`, `components/`, `lib/`), `docs/adr/` (architecture decisions + threat model).

## Conventions

- **TypeScript strict**; let ESLint and the type-checker guide you. Keep comments to non-obvious "why".
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, …).
- **Branches:** short-lived feature branches off the default branch; open a PR with a clear description and the gate results.
- **Security:** never commit a real `.env` or any secret. Validate at trust boundaries. See [SECURITY.md](./SECURITY.md).

## A note on AI-assistant files

Some local AI-assistant tooling files (e.g. `AGENTS.md`, `*.agent.md`, `.github/agents/`, `.github/skills/`) are intentionally **git-ignored** and are not part of the distribution. You can keep your own such files locally; they will not be committed. After cloning and before your first commit you can verify with:

```bash
git status --ignored
```
