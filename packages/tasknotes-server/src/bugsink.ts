import * as SentryLib from "@sentry/bun";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";

const dsn = Bun.env["BUGSINK_DSN"];
const enabled = Bun.env["BUGSINK_ENABLED"] === "true";

if (enabled && dsn !== undefined && dsn !== "") {
  SentryLib.init({
    dataCollection: bugsinkDataCollection(),
    dsn,
    environment: Bun.env["BUGSINK_ENVIRONMENT"] ?? "development",
    release: Bun.env["BUGSINK_RELEASE"],
    // Disable tracing - Bugsink does not support performance monitoring
    tracesSampleRate: 0,
  });
  console.log("Bugsink initialized");

  // Graceful shutdown handler to flush pending events before exit
  const gracefulShutdown = async () => {
    console.log("Shutting down, flushing Bugsink events...");
    await SentryLib.close(2000);
    process.exit(0);
  };

  process.on("SIGTERM", () => void gracefulShutdown());
  process.on("SIGINT", () => void gracefulShutdown());
} else {
  console.log("Bugsink disabled or DSN not configured");
}

// Re-export Bugsink as an initialized module.
// Consumers import from here to guarantee Sentry.init() has executed.
