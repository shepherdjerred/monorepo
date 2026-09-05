# @shepherdjerred/home-assistant

Type-safe access to the [Home Assistant](https://www.home-assistant.io/) REST
and WebSocket APIs for Node.js and Bun. It validates wire data with Zod and can
generate a schema for one Home Assistant instance, so entity IDs, services, and
event types are checked before deployment.

Requires Node.js 24 or newer, or Bun.

## Why use this?

Home Assistant integrations tend to put entity IDs, service names, and payloads
in string literals. Those mistakes otherwise appear only when an automation
reaches a real home. This package validates API responses at runtime and can
generate a schema from one instance, moving those mistakes into the editor and
TypeScript before deployment.

Use it when you are building:

- A Node.js service that reads states or calls services with explicit error
  types for API, authentication, and WebSocket failures.
- A typed automation codebase where `light.kitchen`, `light.turn_on`, and its
  payload must match the Home Assistant instance it will control.
- A real-time integration that subscribes to Home Assistant events over the
  WebSocket API instead of polling REST endpoints.

## Quick start

Install the package and provide a Home Assistant long-lived access token through
your environment:

```bash
bun add @shepherdjerred/home-assistant
```

```ts
import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";

const { HA_TOKEN: token, HA_URL: baseUrl } = process.env;
if (baseUrl === undefined || token === undefined) {
  throw new Error("Set HA_URL and HA_TOKEN before running this program.");
}

const client = new HomeAssistantRestClient({
  baseUrl,
  token,
});

const state = await client.getState("light.kitchen");
console.log(state.state);

await client.callService("light", "turn_on", {
  entity_id: "light.kitchen",
  brightness: 200,
});
```

The runnable [`examples/basic-client.mjs`](examples/basic-client.mjs) requires
`HA_URL`, `HA_TOKEN`, and `HA_ENTITY_ID`; it never prints the token.

## Generate an instance schema

`ha-codegen` reads Home Assistant's states, services, events, and configuration
endpoints, then writes a TypeScript module that describes that instance.

```bash
ha-codegen \
  --url "$HA_URL" \
  --out src/generated/ha-schema.ts \
  --name MyHomeSchema
```

Do not pass credentials on the command line. The generated module includes
private entity IDs and service metadata, so add it to `.gitignore` and
regenerate it when your instance changes.

Use the generated schema as the client type parameter:

```ts
import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";
import type { MyHomeSchema } from "./generated/ha-schema.js";

const { HA_TOKEN: token, HA_URL: baseUrl } = process.env;
if (baseUrl === undefined || token === undefined) {
  throw new Error("Set HA_URL and HA_TOKEN before running this program.");
}

const client = new HomeAssistantRestClient<MyHomeSchema>({
  baseUrl,
  token,
});
```

## API reference

- `HomeAssistantRestClient` reads state and calls REST services.
- `HomeAssistantEventClient` connects to the WebSocket API and supports event
  subscriptions, triggers, service calls, and state reads.
- `HaApiError`, `HaAuthError`, and `HaWebSocketError` distinguish API,
  authentication, and socket failures.
- `ha-codegen --help` lists the command's supported options.

Both clients use the runtime's standard `fetch` and `WebSocket` implementations;
there is no Bun-only runtime dependency.

## Demo recording

The package includes a replayable asciicast generated from a synthetic local
Home Assistant API fixture—no live instance data or credentials are recorded.
It walks from the API data through the generated module to the compile-time
checks that catch an invalid entity, domain, service, or payload:

```bash
asciinema play node_modules/@shepherdjerred/home-assistant/demos/codegen-fixture.cast
```

## Security and compatibility

Use a dedicated long-lived token with only the access your integration needs.
Keep `HA_TOKEN` in your environment or secret manager, never in shell history,
source code, or a generated schema. The package targets Node.js 24+ and Bun;
earlier Node versions are not supported.

## License

GPL-3.0-only.
