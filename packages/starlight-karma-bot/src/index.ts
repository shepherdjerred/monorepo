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

// Reported here rather than in a subsystem so the handlers are armed before
// anything that could reject is imported.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[App] Unhandled promise rejection:", reason);
  Sentry.captureException(reason, { tags: { source: "unhandledRejection" } });
});

process.on("uncaughtException", (error: unknown) => {
  console.error("[App] Uncaught exception:", error);
  Sentry.captureException(error, { tags: { source: "uncaughtException" } });
});

// Dynamic imports, deliberately: static `import` declarations are hoisted and
// would evaluate these modules — logging into Discord and binding the health
// port — BEFORE `Sentry.init` above ever ran, so any startup failure went
// unreported.
await import("./discord/index.ts");
await import("./server/index.ts");

console.warn("=".repeat(50));
console.warn("[App] Starlight Karma Bot is now ready!");
console.warn("=".repeat(50));
