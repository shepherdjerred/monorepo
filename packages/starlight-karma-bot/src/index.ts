import configuration from "./configuration.ts";
import * as Sentry from "@sentry/bun";

console.log("=".repeat(50));
console.log("[App] Starting Starlight Karma Bot...");
console.log(`[App] Environment: ${configuration.environment}`);
console.log(`[App] Git SHA: ${configuration.gitSha}`);
console.log("=".repeat(50));

Sentry.init({
  dsn: configuration.sentryDsn,
  environment: configuration.environment,
  release: configuration.gitSha,
});
console.log("[App] Sentry initialized");

import "./db/index.ts";
import "./discord/index.ts";
import "./server/index.ts";

console.log("=".repeat(50));
console.log("[App] Starlight Karma Bot is now ready!");
console.log("=".repeat(50));
