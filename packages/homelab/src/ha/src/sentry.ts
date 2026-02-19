import * as SentryLib from "@sentry/bun";

const dsn = Bun.env["SENTRY_DSN"];
const enabled = Bun.env["SENTRY_ENABLED"] === "true";

if (enabled && dsn !== undefined && dsn !== "") {
  SentryLib.init({
    dsn,
    environment: Bun.env["SENTRY_ENVIRONMENT"] ?? "development",
    release: Bun.env["SENTRY_RELEASE"],
    // Disable tracing - Bugsink does not support performance monitoring
    tracesSampleRate: 0,
  });
  console.log("Sentry initialized");

  // Graceful shutdown handler to flush pending events before exit
  const gracefulShutdown = async () => {
    console.log("Shutting down, flushing Sentry events...");
    await SentryLib.close(2000);
    process.exit(0);
  };

  process.on("SIGTERM", () => void gracefulShutdown());
  process.on("SIGINT", () => void gracefulShutdown());
} else {
  console.log("Sentry disabled or DSN not configured");
}

// Re-export Sentry as an initialized module.
// Consumers import from here to guarantee Sentry.init() has executed.
export const Sentry = Object.assign({}, SentryLib);
