# @shepherdjerred/home-assistant

TypeScript client for the [Home Assistant](https://www.home-assistant.io/) REST and WebSocket APIs. Zod-validated responses, works under both Bun and Node.js. Ships a `ha-codegen` CLI that generates an instance-specific schema so consumers get compile-time type safety on entity IDs, service calls, and event types — all optional; unparameterized clients keep the original loose behavior.

## Install

```bash
bun add @shepherdjerred/home-assistant
```

## REST client

```ts
import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";

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

## WebSocket event client

```ts
import { HomeAssistantEventClient } from "@shepherdjerred/home-assistant";

const events = new HomeAssistantEventClient({
  baseUrl: "http://homeassistant.local:8123",
  token: process.env.HA_TOKEN,
});

await events.connect();

const unsubscribe = await events.subscribeEvents("state_changed", (event) => {
  console.log("State changed:", event.data);
});

// later
unsubscribe();
await events.close();
```

## Type-safe mode (ha-codegen)

Point the codegen CLI at a live Home Assistant instance to produce a schema module, then parameterize the clients with that schema's type:

```bash
bunx ha-codegen \
  --url "$HA_URL" --token "$HA_TOKEN" \
  --out src/generated/ha-schema.ts \
  --name MySchema
```

```ts
import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";
import type { MySchema } from "./generated/ha-schema.ts";

const ha = new HomeAssistantRestClient<MySchema>({ baseUrl, token });

await ha.callService("light", "turn_on", {
  entity_id: "light.kitchen",
  brightness: 200,
});
// Compile errors for unknown entities/domains/services:
// ha.callService("light", "turn_on", { entity_id: "media_player.bedroom" }); ❌ not a light
// ha.callService("lite", "turn_on", { entity_id: "light.kitchen" });         ❌ no such domain
// ha.getState("light.kitcen");                                                ❌ typo
```

The generated file contains entity IDs and service definitions from the live instance — **do not commit it**. Add the output path to `.gitignore` and regenerate in CI (see the temporal package for the Dagger pattern).

## License

GPL-3.0-only.
