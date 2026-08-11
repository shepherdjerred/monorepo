# @shepherdjerred/home-assistant

TypeScript client for the [Home Assistant](https://www.home-assistant.io/) REST and WebSocket APIs. Zod-validated responses, works under both Bun and Node.js (standard global `fetch` and `WebSocket`). Workspace-internal package — consumed by other packages in this monorepo via `"@shepherdjerred/home-assistant": "workspace:*"`; not published to npm.

## Quick start

Everything exports from `src/index.ts`:

```ts
import {
  HomeAssistantRestClient,
  HomeAssistantEventClient,
} from "@shepherdjerred/home-assistant";

const client = new HomeAssistantRestClient({
  baseUrl: "http://homeassistant.local:8123",
  token: process.env.HA_TOKEN,
});

const state = await client.getState("light.kitchen");
await client.callService("light", "turn_on", {
  entity_id: "light.kitchen",
  brightness: 200,
});
```

`HomeAssistantEventClient` covers the WebSocket API (`connect`, `subscribeEvents`, `subscribeTrigger`, `callService`, `getStates`). Error types `HaApiError`, `HaAuthError`, and `HaWebSocketError` are also exported.

## Type-safe mode (`ha-codegen`)

The package ships a `ha-codegen` bin that introspects a live Home Assistant instance and emits a schema module. Parameterize either client with the generated schema type to get compile-time checking of entity IDs, domains, services, and event types; unparameterized clients keep the loose default behavior.

```bash
bunx ha-codegen --url "$HA_URL" --token "$HA_TOKEN" --out src/generated/ha-schema.ts --name MySchema
```

The output contains instance-specific entity IDs and service definitions — gitignore it and regenerate at build time.

## Commands

```bash
bun run typecheck
bun run lint
bun test
```

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
