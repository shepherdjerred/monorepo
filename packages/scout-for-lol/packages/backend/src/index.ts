import configuration from "#src/configuration.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { filterScoutSentryEvent } from "#src/sentry-filters.ts";
import { initializeTracing } from "#src/observability/tracing.ts";

// Initialize OTel tracing first so any subsequent module that opens a span
// has a tracer provider attached. No-op when TELEMETRY_ENABLED is unset.
initializeTracing();

const logger = createLogger("app");

logger.info("🚀 Starting Scout for LoL backend application");
logger.info(`📦 Version: ${configuration.version}`);
logger.info(`🔧 Environment: ${configuration.environment}`);
logger.info(`🌐 Git SHA: ${configuration.gitSha}`);
logger.info(`🔌 Port: ${configuration.port.toString()}`);

// S3 (SeaweedFS) is the canonical raw match/prematch/timeline store — a missing
// bucket in beta/prod means every ingest silently no-ops and loses data
// forever. Fail fast at boot rather than at notification time. The per-call
// helpers keep their graceful no-op so dev/test still run without a bucket.
if (
  (configuration.environment === "beta" ||
    configuration.environment === "prod") &&
  configuration.s3BucketName === undefined
) {
  throw new Error(
    `S3_BUCKET_NAME is required in ${configuration.environment} — S3 is the canonical raw store; refusing to start without it.`,
  );
}

if (
  configuration.sentryDsn !== undefined &&
  configuration.sentryDsn.length > 0
) {
  logger.info("🔍 Initializing Sentry error tracking");
  Sentry.init({
    dsn: configuration.sentryDsn,
    environment: configuration.environment,
    // Use image tag (e.g. "2.0.0-998") as the release so Bugsink groups
    // events per deploy and matches what ArgoCD reports.
    release: configuration.version,
    // Drop expected noise (Riot upstream 5xx, boundary Riot-ID validation)
    // before it leaves the SDK. See packages/backend/src/sentry-filters.ts
    // for the rationale.
    beforeSend: filterScoutSentryEvent,
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
import { shutdownHttpServer } from "#src/http-server.ts";

// Fail fast if Data Dragon champion assets are missing — deploy-time
// failure beats notification-time 404 per 2026-04-20 resilience audit.
logger.info("🖼️  Validating Data Dragon champion assets");
import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";
await validateChampionAssets();

logger.info("🔌 Starting Discord bot initialization");
import "@scout-for-lol/backend/discord/index.ts";

logger.info("🌱 Seeding Season table from SEASONS constant");
import { prisma } from "#src/database/index.ts";
import { seedSeasons } from "#src/database/season-seeder.ts";
await seedSeasons(prisma);

logger.info("📈 Seeding scheduled-report freshness gauge from DB");
import { seedScheduledReportLastSuccessMetric } from "#src/reports/schedule-metric-seed.ts";
await seedScheduledReportLastSuccessMetric(prisma);

logger.info("⏰ Starting cron job scheduler");
import { startCronJobs } from "#src/league/cron.ts";
void startCronJobs();

// Incrementally seed the summoner-search index from existing data. Idempotent
// and cheap to re-run (inserts only new PUUIDs); background so it never blocks
// boot or request serving.
import { backfillFromExisting } from "#src/lib/riot/summoner-index.ts";
void (async () => {
  try {
    const result = await backfillFromExisting();
    logger.info(
      `🗂️  Summoner index seeded: ${result.inserted.toString()} new of ${result.scanned.toString()} scanned`,
    );
  } catch (error) {
    logger.warn("Summoner index backfill failed (non-fatal)", { error });
  }
})();

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
