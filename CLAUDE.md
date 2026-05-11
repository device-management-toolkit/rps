# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RPS (Remote Provisioning Server) activates and configures Intel® AMT devices. It is a Node.js / TypeScript service that speaks WSMAN to AMT firmware through the [RPC](https://github.com/device-management-toolkit/rpc-go) client running on the edge device. RPC opens a WebSocket to RPS, RPS drives the device through one or more xstate state machines, and final configuration data is persisted to Postgres / Vault. Sibling service: [MPS](https://github.com/device-management-toolkit/mps).

## Commands

- `npm start` — `tsc` then run `dist/Index.js`. REST on `web_port` (default `8081`), RPC WebSocket on `websocketport` (default `8080`).
- `npm run watch` — nodemon TS watcher.
- `npm test` — Vitest run with coverage. `npm run test:watch` for interactive.
- `npm run test:ci` — same plus junit / github-actions reporters.
- Single test: `npx vitest run src/path/to/file.test.ts` (or `-t "name"` to filter by test name).
- `npm run lint` — ESLint over the repo. `npm run prettify` / `npm run ci-prettify` for formatting.
- `npm run build` — `tsc --project tsconfig.build.json` + writes `dist/utils/version.js` via `genversion`.
- `docker-compose up -d` — full stack (rps + postgres + vault + consul) for API testing. Postman collection at `src/test/collections/rps.postman_collection.json`.

Node `>=20.19.0`. Project is ESM (`"type": "module"`); intra-repo imports use `.js` extensions on `.ts` source paths.

## Architecture

### Entry point and wiring (`src/Index.ts`)

1. If `consul_enabled`, `setupServiceManager()` pulls config from Consul before anything else.
2. `Configurator` (`src/Configurator.ts`) constructs `Validator`, `DataProcessor`, the db handle via `DbCreatorFactory`, the secrets manager via `SecretManagerCreatorFactory`, then `DomainCredentialManager` and `ProfileManager`.
3. Two WebSocket servers come up: `WebSocketListener` (RPC clients) and `WSEnterpriseAssistantListener` (Microsoft EA integration for cert enrollment).
4. Express mounts `routes/` under `/api/v1`. To extend the request pipeline, add a `.ts` file under `src/middleware/custom/`; once compiled, the corresponding `.js` in `dist/middleware/custom/` is auto-discovered and dynamically imported at startup. Coverage explicitly excludes this directory.
5. `MqttProvider` emits lifecycle / telemetry events when `mqtt_address` is configured.

### Configuration (`src/utils/Environment.ts`)

Uses [`rc`](https://www.npmjs.com/package/rc) to layer config: defaults in `.rpsrc` → `RPS_*` env vars (lowercased and parsed by `parseEnvValue`) → CLI args. `Environment.Config` is the singleton consumed everywhere. Several timers/flags are defaulted here (`delay_tls_timer`, `wsman_max_attempts`, `amt_post_tls_reject`, `amt_legacy_tls_compatibility`, `amt_tls_tunnel_persistent`). Treat this file as the source of truth for tunables.

### Device flow — orchestrated by XState (CRITICAL)

[XState](https://github.com/statelyai/xstate) v5 is **the** orchestration mechanism for every device interaction. Each file in `src/stateMachines/` is an xstate `setup({...}).createMachine({...})` — guards, invoked promise actors (via `fromPromise`), and `assign` actions chain the WSMAN exchanges. **Do not bypass the state machine to "just call WSMAN" inline** — every step belongs in a state with explicit transitions so retries, error fan-out (`error.ts`), and telemetry stay coherent.

`WebSocketListener` → `DataProcessor.processData` (`src/DataProcessor.ts`) dispatches on `clientMsg.method`:

- `ACTIVATION` → `stateMachines/activation.ts` — the root machine. Branches on profile (`tlsMode`, `ciraConfigName`, `wifiConfigs`, `ieee8021xProfileName`, `tags`) and on device state (already activated CCM/ACM vs pre-provisioning, AMT major version). Spawns child machines below.
- `DEACTIVATION` → `stateMachines/deactivation.ts`
- `MAINTENANCE` → `stateMachines/maintenance/*` (syncTime, changePassword, syncHostName, syncIP, syncDeviceInfo)

Composed child machines invoked from activation (order is profile-dependent): `featuresConfiguration`, `networkConfiguration` → `wiredNetworkConfiguration` / `wifiNetworkConfiguration`, `proxyConfiguration`, `ciraConfiguration`, `tls`, `unconfiguration`, `enterpriseAssistant`, `timeMachine`, `error`. Shared helpers — `invokeWsmanCall`, `processTLSTunnelResponse`, common context types — live in `stateMachines/common.ts`. Devices in-flight live in the `devices` map (`src/devices.ts`); `HttpHandler` builds WSMAN-over-HTTP envelopes.

When modifying any state machine, also update its sibling `.test.ts` — those tests assert on transitions and invoked actors, not just outputs.

### TLS / cert handling and the E2E TLS activation flow (CRITICAL)

The **E2E TLS activation flow** documented in the [rpc-go wiki](https://github.com/device-management-toolkit/rpc-go/wiki/Activating-AMT-with-E2E-TLS-and-RPS) is the contract this service implements. **Before changing anything in `stateMachines/activation.ts`, `stateMachines/tls.ts`, `TLSTunnelManager.ts`, `certManager.ts`, or the post-activation cert path, re-read that mermaid diagram and confirm every branch still maps to a reachable state.** Branches that must remain intact:

- Already-activated (CCM/ACM) path: "TLS already configured?" → if yes, check whether the current cert is signed by the MPS root and reuse vs regenerate; if no, generate a fresh cert from the MPS root.
- Pre-provisioning, **AMT 19+**: ODCA cert validation → activate to CCM over E2E TLS port **16993** → AMT generates a self-signed cert → RPS adds the DMT cert.
- Pre-provisioning, **AMT 18 with `--tls-tunnel`** (RPC flag): activate over non-TLS port **16992** → post-activation cert handling, version-gated (AMT 16–18 vs ≤15).
- Pre-provisioning, **AMT 18 without the flag**: activate over **16992**, no certs added, device stays non-TLS.
- All successful TLS paths end with `amt_post_tls_reject` effectively `true` for subsequent traffic.

Supporting files: `TLSTunnelManager.ts` (local tunnel into AMT), `certManager.ts`, `NodeForge.ts`, `utils/certHelpers.ts`. The three TLS knobs:

- `amt_post_tls_reject` — strict cert validation once RPS owns the DMT root cert (AMT 19+, or AMT ≤18 in tunnel mode).
- `amt_legacy_tls_compatibility` — relax cipher/protocol floor for older AMT firmware.
- `amt_tls_tunnel_persistent` — reuse the tunnel across WSMAN calls vs tear down per message.

### REST API (`src/routes/`)

`/api/v1/admin` mounts CRUD routers for: `domains`, `profiles`, `ciraconfigs`, `wirelessconfigs`, `ieee8021xconfigs`, `proxyconfigs`, `version`, `health`. Routes use `express-validator` and `express-promise-router`; OData query parsing through `routes/admin/odataValidator.ts`. Public surface is described in `swagger.yaml`.

### Data and secrets (provider-pluggable)

Both layers are dynamically imported by provider name:

- DB: `factories/DbCreatorFactory.ts` → `import('../data/${db_provider}/index.js')`. Only `postgres` ships (`src/data/postgres/`, with table classes in `tables/`). Uses `pg` + `pg-format`. SSL is configured via `postgres_ssl_ca|cert|key|reject_unauthorized`.
- Secrets: `factories/SecretManagerCreatorFactory.ts` → `import('../secrets/${secrets_provider}/index.js')`. Only `vault` ships (`src/secrets/vault/`). AMT passwords, MEBx passwords, profile/domain secrets all live in Vault, never in Postgres.

`waitForDB` and `waitForSecretsManager` (in `Index.ts`) use exponential backoff so the service can come up before its dependencies are ready.

### Testing notes

- Vitest, globals enabled, `src/**/*.test.ts`. Coverage via `@vitest/coverage-v8` (lcov / cobertura / html in `coverage/`).
- `vitest.config.ts` registers a **test-only** Vite plugin that injects `/* @vite-ignore */` into three specific dynamic-import call sites (`Index.ts`, `DbCreatorFactory.ts`, `SecretManagerCreatorFactory.ts`). The pragmas are intentionally not in source — Vite's static analyzer chokes on variable-driven dynamic imports while Node runs them fine. If you add a new variable-driven `import()` and tests fail with a Vite warning, extend the `targets` list there rather than polluting production source.
- State-machine tests model xstate actor behavior — when changing a state machine, expect to update both the machine and its `.test.ts` together; the tests often assert on transitions and invoked services rather than just outputs.

## Implementation guidelines (non-negotiable)

- **Never hand-author a WSMAN message in this repo.** All WSMAN XML construction goes through the `@device-management-toolkit/wsman-messages` dependency — use the `AMT`, `IPS`, and `CIM` namespaces (as imported in `stateMachines/activation.ts` and friends) to build messages. If a needed method is missing, fix it in `wsman-messages` upstream rather than crafting raw XML here.
- **Every state interaction belongs in an XState machine.** Add or modify states/guards/actors rather than calling WSMAN from outside the state machine layer.
- **Before declaring work done, all three must be green:** `npm test` (unit tests), `npm run ci-prettify` (formatting), `npm run lint` (ESLint). CI runs the same; fix locally first.
- **Touching the activation / TLS path?** Verify the E2E TLS flow branches above are all still reachable, and update the corresponding `.test.ts` for any machine whose transitions you change.

## Commit conventions (enforced by commitlint)

Format: `<type>(<scope>): <subject>` with body and optional footer. Types: `feat | fix | docs | style | refactor | perf | test | build | ci | revert`. Common scopes used in this repo: `activation`, `api`, `config`, `db`, `deactivation`, `deps`, `deps-dev`, `docker`, `events`, `gh-actions`, `health`, `maintenance`, `secrets`, `state-machine`, `utils`. Subject + body lines ≤72 chars. Releases are driven by `semantic-release` (`.releaserc.json`), so commit type/scope matters — it controls versioning and `CHANGELOG.md`. Linear history is preferred; PR authors merge via Rebase or Squash.
