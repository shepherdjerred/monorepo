// Shared middle layer for the discord-plays game bots (pokemon, mario-kart):
// tracing/metrics wiring, the loopback audio transport, the Go-Live streamer
// base class, the web server, and the bot entrypoint. Each game supplies its own
// emulator, drivers, goal/leaderboard systems, socket dispatch, and metrics
// extras; this package holds the parts that were parallel-evolved identically.
//
// Every module is exposed at its own subpath via the `./*` pattern in
// `package.json#exports`. Consumers import directly from those paths, e.g.:
//
//   import { initializeTracing } from "@shepherdjerred/discord-plays-core/observability/tracing.ts";
//   import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
//   import { createAudioTransport } from "@shepherdjerred/discord-plays-core/stream/audio-transport.ts";
//   import { GameStreamerBase } from "@shepherdjerred/discord-plays-core/stream/game-streamer-base.ts";
//   import { createWebServer } from "@shepherdjerred/discord-plays-core/webserver/server.ts";
//   import { bootGameBot } from "@shepherdjerred/discord-plays-core/entry.ts";
//
// This keeps the root entry point lean and avoids the no-re-exports lint rule
// (same convention as discord-stream-lifecycle).
export const PACKAGE_NAME = "@shepherdjerred/discord-plays-core";
