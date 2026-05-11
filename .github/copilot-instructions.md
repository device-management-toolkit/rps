# GitHub Copilot Instructions

See **[../CLAUDE.md](../CLAUDE.md)** — the canonical guide for AI coding assistants in this repository. The content is tool-neutral and applies to GitHub Copilot Chat / Copilot Workspace just as it does to any other agent. Edit `CLAUDE.md`; this file is a pointer.

Key non-negotiables (full detail in `CLAUDE.md`):

- Never hand-author WSMAN XML in production code — use `@device-management-toolkit/wsman-messages` (`AMT` / `IPS` / `CIM` namespaces). Raw XML is permitted only in `src/test/helper/` fixtures.
- All device interactions go through the XState v5 machines in `src/stateMachines/`. Do not call WSMAN from outside the state machine layer.
- Touching `stateMachines/activation.ts`, `stateMachines/tls.ts`, `TLSTunnelManager.ts`, or `certManager.ts` requires re-checking every branch of the [E2E TLS flow](https://github.com/device-management-toolkit/rpc-go/wiki/Activating-AMT-with-E2E-TLS-and-RPS).
- REST API (`/api/v1/admin/*`, `swagger.yaml`) and the WebSocket `ClientMsg` schema must stay backwards compatible.
- Small, focused PRs only. No scope creep.
- Before declaring done: `npm test`, `npm run ci-prettify`, `npm run lint` all green.
