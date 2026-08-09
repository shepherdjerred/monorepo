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

// Armed here, before anything that could reject is imported.
//
// These MUST exit. Installing a listener suppresses the runtime's default
// fatal behavior — verified in Bun: with a log-only handler, an unhandled
// rejection leaves the process alive and it still exits 0. Reporting and
// returning would therefore leave the bot running in an undefined state while
// the still-connected gateway keeps `/live` answering 200, so Kubernetes would
// never recycle it. That is exactly the zombie the probes in this change exist
// to catch, and a swallowing handler would quietly defeat them.
function exitOnFatal(source: string, error: unknown): void {
  console.error(`[App] ${source}:`, error);
  Sentry.captureException(error, { tags: { source } });
  void (async () => {
    try {
      // Best-effort flush; the report is lost if the process dies first.
      await Sentry.close(2000);
    } catch (flushError) {
      console.error("[App] Failed to flush Sentry before exit:", flushError);
    } finally {
      process.exit(1);
    }
  })();
}

process.on("unhandledRejection", (reason: unknown) => {
  exitOnFatal("unhandledRejection", reason);
});

process.on("uncaughtException", (error: unknown) => {
  exitOnFatal("uncaughtException", error);
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
