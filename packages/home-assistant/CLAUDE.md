# packages/home-assistant

Generic TypeScript client library for the [Home Assistant](https://www.home-assistant.io/) REST and WebSocket APIs. No monorepo-specific assumptions, no dependency on `@digital-alchemy/*`, no type generation — all responses are parsed with Zod.

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

- `HomeAssistantRestClient` — `getConfig`, `getStates`, `getState`, `callService`, `fireEvent`, `renderTemplate`, `getHistory`.
- `HomeAssistantEventClient` — `connect`, `close`, `subscribeEvents`, `subscribeTrigger`, `callService`, `getStates`.

## Commands

```bash
bun install
bun run typecheck
bun run lint
bun test
```
