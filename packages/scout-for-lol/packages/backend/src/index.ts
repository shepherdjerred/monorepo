import configuration from "@scout-for-lol/backend/configuration.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("app");

logger.info("🚀 Starting Scout for LoL backend application");
logger.info(`📦 Version: ${configuration.version}`);
logger.info(`🔧 Environment: ${configuration.environment}`);
logger.info(`🌐 Git SHA: ${configuration.gitSha}`);
logger.info(`🔌 Port: ${configuration.port.toString()}`);

if (
  configuration.sentryDsn !== undefined &&
  configuration.sentryDsn.length > 0
) {
  logger.info("🔍 Initializing Sentry error tracking");
  Sentry.init({
    dsn: configuration.sentryDsn,
    environment: configuration.environment,
    release: configuration.gitSha,
  });
  logger.info("✅ Sentry initialized successfully");
} else {
  logger.info("⚠️  Sentry DSN not configured, error tracking disabled");
}

// Initialize metrics (must be imported early to set up metrics collection)
logger.info("📊 Initializing metrics system");
import "@scout-for-lol/backend/metrics/index.ts";

// Initialize HTTP server for health checks and metrics
logger.info("🌐 Starting HTTP server for health checks and metrics");
import { shutdownHttpServer } from "@scout-for-lol/backend/http-server.ts";

logger.info("🔌 Starting Discord bot initialization");
import "@scout-for-lol/backend/discord/index.ts";

logger.info("⏰ Starting cron job scheduler");
import { startCronJobs } from "@scout-for-lol/backend/league/cron.ts";
startCronJobs();

logger.info("✅ Backend application startup complete");

// Handle graceful shutdown
process.on("SIGTERM", () => {
  logger.info("🛑 Received SIGTERM, shutting down gracefully");
  void (async () => {
    await shutdownHttpServer();
    process.exit(0);
  })();
});

process.on("SIGINT", () => {
  logger.info("🛑 Received SIGINT, shutting down gracefully");
  void (async () => {
    await shutdownHttpServer();
    process.exit(0);
  })();
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ Unhandled Promise Rejection:", reason);
  logger.error("Promise:", promise);
  Sentry.captureException(reason);

  // Track unhandled errors in metrics
  void (async () => {
    try {
      const metrics = await import("./metrics/index.js");
      metrics.unhandledErrorsTotal.inc({ error_type: "unhandled_rejection" });
    } catch {
      // Ignore if metrics module fails to import
    }
  })();
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("❌ Uncaught Exception:", error);
  Sentry.captureException(error);

  // Track unhandled errors in metrics
  void (async () => {
    try {
      const metrics = await import("./metrics/index.js");
      metrics.unhandledErrorsTotal.inc({ error_type: "uncaught_exception" });
    } catch {
      // Ignore if metrics module fails to import
    }
  })();

  process.exit(1);
});
