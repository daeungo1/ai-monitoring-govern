# Upstream attribution

This is the real [ytthuan/FoundryMonitorDashboard](https://github.com/ytthuan/FoundryMonitorDashboard),
cloned with native Git at commit `2fe7fbe72591589139027fdf77a397ac7740cd00`.

Upstream is licensed under MIT, copyright © 2026 Foundry Monitor Dashboard contributors.
The original `LICENSE` is retained without modification and must accompany redistributed packages.
The React dashboard, navigation, charts, filtering, theme, and Fastify API originate upstream.

Local integration replaces source selection with explicit live/fixture modes, adds a workspace
`AppDependencies` API-only adapter and OpenAI account ARM metrics adapter, preserves nullable
usage/cost, and adds streaming and safe request-ledger views. Upstream Azure/mock adapters remain
as reference files and for upstream conformance tests, but are not reachable from the server.
The upstream README documents upstream behavior; use `INTEGRATION.md` for this variant.
