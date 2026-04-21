# packages/home-assistant

TypeScript client library for the [Home Assistant](https://www.home-assistant.io/) REST and WebSocket APIs. No monorepo-specific assumptions, no dependency on `@digital-alchemy/*`. Responses are parsed with Zod. Optional `ha-codegen` CLI produces an instance-specific schema that parameterizes the clients for compile-time type safety; unparameterized clients fall back to the loose default.

## Runtime

Works under both Bun and Node.js. Uses standard global `fetch` and `WebSocket`.

## Public API

```
import {
  HomeAssistantRestClient,
  HomeAssistantEventClient,
  HaApiError,
  HaAuthError,
  HaWebSocketError,
} from "@shepherdjerred/home-assistant";
```

- `HomeAssistantRestClient<S extends HaSchema = DefaultHaSchema>` — `getConfig`, `getStates`, `getState`, `callService`, `fireEvent`, `renderTemplate`, `getHistory`. `S` parameterizes entity IDs, domains, services, and event types.
- `HomeAssistantEventClient<S extends HaSchema = DefaultHaSchema>` — `connect`, `close`, `subscribeEvents`, `subscribeTrigger`, `callService`, `getStates`.

## Codegen

`ha-codegen` is exposed as a bin. It hits `/api/states`, `/api/services`, `/api/events`, `/api/config` on a live HA instance and emits a single typed schema module consumers import:

```bash
bunx ha-codegen --url $HA_URL --token $HA_TOKEN --out <path>.ts --name MySchema
```

Generated output contains private entity IDs and service definitions and **must never be committed** — consumer packages gitignore the output path and regenerate in Dagger CI (same pattern as Prisma packages).

## Commands

```bash
bun install
bun run typecheck
bun run lint
bun test
```
