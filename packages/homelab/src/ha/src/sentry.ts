import * as Sentry from "@sentry/bun";

const dsn = Bun.env["SENTRY_DSN"];
const enabled = Bun.env["SENTRY_ENABLED"] === "true";

if (enabled && dsn) {
  Sentry.init({
    dsn,
    environment: Bun.env["SENTRY_ENVIRONMENT"] ?? "development",
    release: Bun.env["SENTRY_RELEASE"],
    // Disable tracing - Bugsink does not support performance monitoring
    tracesSampleRate: 0,
  });
  console.log("Sentry initialized");

  // Graceful shutdown handler to flush pending events before exit
  const gracefulShutdown = () => {
    console.log("Shutting down, flushing Sentry events...");
    void Sentry.close(2000).then(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
} else {
  console.log("Sentry disabled or DSN not configured");
}

export { Sentry };
