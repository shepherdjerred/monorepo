import configuration from "./configuration.ts";
import { initObservability } from "./observability.ts";

console.warn("=".repeat(50));
console.warn("[App] Starting Starlight Karma Bot...");
console.warn(`[App] Environment: ${configuration.environment}`);
console.warn(`[App] Git SHA: ${configuration.gitSha}`);
console.warn("=".repeat(50));

// Idempotent — `scripts/start.ts` already armed this before running
// migrations, so this only does work when the entrypoint is run directly.
initObservability();

// Dynamic imports, deliberately: static `import` declarations are hoisted and
// would evaluate these modules BEFORE `Sentry.init` above ever ran, so any
// startup failure went unreported.
//
// Order matters. The health server binds FIRST so `/live` and `/ready` answer
// throughout the slow parts of startup — command registration and the gateway
// login. Bound the other way round, probes hit connection-refused for the
// whole login window and a slow or rate-limited login would burn the startup
// budget and get the pod killed. `/ready` stays 503 until the gateway is up,
// which is the correct signal during that window.
await import("./server/index.ts");
await import("./discord/index.ts");

const { loginDiscord } = await import("./discord/client.ts");
await loginDiscord();

console.warn("=".repeat(50));
console.warn("[App] Starlight Karma Bot is now ready!");
console.warn("=".repeat(50));
