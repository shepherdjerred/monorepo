# @shepherdjerred/home-assistant

Generic TypeScript client for the [Home Assistant](https://www.home-assistant.io/) REST and WebSocket APIs. Zod-validated responses, no code generation, works under both Bun and Node.js.

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

## License

GPL-3.0-only.
