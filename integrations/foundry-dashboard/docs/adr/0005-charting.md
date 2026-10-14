# ADR-0005 — Charting via Recharts + a shadcn-style chart primitive

**Status:** Accepted

## Context

The dashboard needs time-series and categorical charts (tokens, latency, errors,
cost over time; breakdowns by model/agent/operation) that match the shadcn/ui +
Tailwind design system already chosen for the project. We want theme-consistent,
accessible charts without adopting a second styling paradigm.

## Decision

- Use **Recharts**, wrapped behind a **shadcn-style chart primitive**
  (`ChartContainer` / `ChartTooltip` / config-driven theming) so charts inherit
  design tokens and theming from the design system.
- **Primitives live in `src/components/ui/**`** (owned by `@ui-system`) — the
  reusable, presentation-only chart building blocks.
- **Concrete chart compositions live in `src/components/charts/**`** (owned by
  `@dashboard`) — these bind real telemetry (via `@client-data` hooks) to
  primitives.
- Charts consume already-shaped contract DTOs (ADR-0003); they do not fetch or
  transform raw Azure data themselves.

## Consequences

- One styling system end to end; charts theme with the rest of the UI.
- Clear ownership seam: `@ui-system` owns look/primitive API, `@dashboard` owns
  what data goes in — prevents cards-in-cards and bespoke per-chart styling.
- Recharts' bundle/perf characteristics are acceptable for dashboard-scale data;
  large series are bounded upstream by query granularity and caps (ADR-0006).

## Alternatives considered

- **visx** — more flexible/low-level but more code and no shadcn pairing.
- **Chart.js** — canvas-based; weaker React/theming integration with shadcn.
- **nivo** — capable but its own theming model competes with Tailwind/shadcn
  tokens.
