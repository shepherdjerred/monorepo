import configuration from "#src/configuration.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { filterScoutSentryEvent } from "#src/sentry-filters.ts";
import { initializeTracing } from "#src/observability/tracing.ts";
import { shutdownProductAnalytics } from "#src/analytics/product-analytics.ts";
import {
  shutdownDynamicConfig,
  temporalCallGraphTracing,
} from "#src/config/dynamic.ts";
import { featureFlagMetrics } from "#src/metrics/feature-flags.ts";

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
    // Scout's NodeSDK owns the global OpenTelemetry providers. Sentry remains
    // responsible for error tracking without attempting a second registration.
    skipOpenTelemetrySetup: true,
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

// Fail before the HTTP health server or Discord bot starts if either the Data
// Dragon assets or checksum-pinned private Classic fonts are unavailable.
logger.info("🖼️  Validating startup assets before starting runtime services");
import { startBackendRuntime } from "#src/startup.ts";
// Before the HTTP server and the Discord gateway: guild command registration
// reads the explore allowlist, and it must see a resolved value. Seeded with
// the env-derived values, so an unreachable Flipt changes nothing.
const { initializeDynamicConfig } = await import("#src/config/dynamic.ts");
await initializeDynamicConfig({
  seed: {
    exploreGuildAllowlist: configuration.exploreGuildAllowlist,
    llmHourlyTokenBudget: configuration.llmHourlyTokenBudget,
    llmDailyTokenBudget: configuration.llmDailyTokenBudget,
    reportAiModel: configuration.reportAiModel ?? "gpt-5.6-sol",
    bettingParlayAiModel: configuration.bettingParlayAiModel ?? "gpt-5.6-sol",
    exploreModel: configuration.exploreModel,
    tournamentApiMode: configuration.tournamentApiMode,
    tournamentMaxOpenLobbies: configuration.tournamentMaxOpenLobbies,
    // Flag-only, so there is no env-derived value: seed the definition's
    // default, which is the pre-flag behaviour.
    temporalCallGraphTracing: false,
  },
  metrics: featureFlagMetrics,
});

initializeTracing({
  domain: "scout",
  environment: configuration.environment,
  namespace: configuration.temporalNamespace,
  taskQueue: `scout-${configuration.environment}-workflows`,
  workerRole: "scout-backend",
});
logger.info("Temporal call-graph tracing boot decision resolved", {
  enabled: temporalCallGraphTracing(),
});

const { shutdownHttpServer, shutdownTemporal, shutdownDiscord } =
  await startBackendRuntime();

const { startScoutCompetitionActivityWorker } =
  await import("#src/league/tasks/competition/temporal-worker.ts");
const competitionActivityWorker = await startScoutCompetitionActivityWorker();

logger.info("🌱 Seeding Season table from SEASONS constant");
import { prisma } from "#src/database/index.ts";
import { seedSeasons } from "#src/database/season-seeder.ts";
await seedSeasons(prisma);

logger.info("📈 Seeding scheduled-report freshness gauge from DB");
import { seedScheduledReportLastSuccessMetric } from "#src/reports/schedule-metric-seed.ts";
await seedScheduledReportLastSuccessMetric(prisma);

logger.info("✅ Backend application startup complete");

// Handle graceful shutdown
let shutdownStarted = false;
const gracefullyShutdown = (signal: "SIGINT" | "SIGTERM"): void => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info(`🛑 Received ${signal}, shutting down gracefully`);
  void (async () => {
    await shutdownTemporal();
    await competitionActivityWorker?.shutdown();
    await shutdownHttpServer();
    await shutdownDiscord();
    // Stops the config poller before analytics flushes, so a refresh cannot
    // race the exit.
    await shutdownDynamicConfig();
    await shutdownProductAnalytics();
    await prisma.$disconnect();
    process.exit(0);
  })();
};

process.on("SIGTERM", () => {
  gracefullyShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  gracefullyShutdown("SIGINT");
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
