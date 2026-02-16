import configuration from "./configuration.ts";
import * as Sentry from "@sentry/bun";

console.warn("=".repeat(50));
console.warn("[App] Starting Starlight Karma Bot...");
console.warn(`[App] Environment: ${configuration.environment}`);
console.warn(`[App] Git SHA: ${configuration.gitSha}`);
console.warn("=".repeat(50));

Sentry.init({
  dsn: configuration.sentryDsn,
  environment: configuration.environment,
  release: configuration.gitSha,
});
console.warn("[App] Sentry initialized");

import "./db/index.ts";
import "./discord/index.ts";
import "./server/index.ts";

console.warn("=".repeat(50));
console.warn("[App] Starlight Karma Bot is now ready!");
console.warn("=".repeat(50));
