# ADR-0007 — Code-based TanStack Router (not file-based)

**Status:** Accepted

## Context

The dashboard needs client-side routing (overview, per-agent/model views,
detail panels). TanStack Router offers two authoring styles: **file-based**
routing (a Vite plugin generates a route tree from the filesystem) and
**code-based** routing (`createRouter` / `createRoute` defined explicitly in
code).

File-based routing adds a build-time plugin and codegen step, and has a known
friction point under **Vitest**: tests can break or require special handling
around the generated route tree, complicating the contract/unit test setup that
is central to this project (ADR-0003). The route surface here is modest.

## Decision

Use **code-based TanStack Router**: routes are declared explicitly with
`createRoute` and assembled via `createRouter`, with **no router plugin and no
route-tree codegen**.

- Routes live in **`src/routes/**`** and the router is bootstrapped in
  **`src/router.tsx`** — both **owned by `@dashboard`** (with `src/main.tsx`).
- No generated `routeTree.gen.ts`; the tree is hand-assembled, so it is plain
  importable code in tests.

## Consequences

- No extra Vite plugin/codegen in the build; fewer moving parts.
- Tests import routes/router as ordinary modules — avoids the Vitest
  route-tree gotcha entirely.
- Slightly more boilerplate when adding routes (explicit registration) vs
  filesystem conventions — acceptable at this app's route count.
- Ownership is unambiguous: routing changes go through `@dashboard`.

## Alternatives considered

- **File-based routing (plugin + codegen)** — rejected: adds build tooling and
  the Vitest route-tree friction for little benefit at this scale.
- **React Router / other router** — rejected: project standard is TanStack
  Router (pairs with TanStack Query/Table already in the stack).
