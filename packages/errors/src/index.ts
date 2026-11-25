import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createIngestRateLimiter } from "#domain/rate-limit.ts";
import { behaviorConfig, BootstrapSchema } from "#infrastructure/config.ts";
import {
  createDatabase,
  createPrismaErrorsRepository,
} from "#infrastructure/db.ts";
import { createInMemoryErrorsRepository } from "#infrastructure/in-memory-db.ts";
import {
  createMailOutboxClient,
  dispatchPendingOutbox,
} from "#infrastructure/mail-outbox.ts";
import {
  createErrorsMetrics,
  initializeTelemetry,
  shutdownTelemetry,
} from "#infrastructure/telemetry.ts";
import { createTrackerIssueClient } from "#infrastructure/tracker-client.ts";
import { createAdminApp } from "#server/admin-app.ts";
import { createIngestApp } from "#server/ingest-app.ts";

const effectiveEnv: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(Bun.env)) {
  if (typeof value === "string") {
    effectiveEnv[key] = value;
  }
}

const rawDbUrl = effectiveEnv["DATABASE_URL"];
const hasDatabaseUrl = rawDbUrl !== undefined && rawDbUrl.trim().length > 0;
if (!hasDatabaseUrl) {
  effectiveEnv["DATABASE_URL"] =
    "postgresql://smoke:smoke@127.0.0.1:15432/errors";
  const rawMode = effectiveEnv["FEATURE_FLAGS_MODE"];
  if (rawMode === undefined || rawMode.trim().length === 0) {
    effectiveEnv["FEATURE_FLAGS_MODE"] = "disabled";
  }
}

const config = BootstrapSchema.parse(effectiveEnv);
const flagsDisabled = config.FEATURE_FLAGS_MODE === "disabled";

await initFeatureFlags({
  environment: effectiveEnv,
  onInitializationFailure: (message) => {
    console.warn(
      JSON.stringify({
        message: "errors_feature_flags_init_failed",
        detail: message,
      }),
    );
  },
});

const behavior = behaviorConfig(config.ENVIRONMENT, flagsDisabled);
initializeTelemetry(config, await behavior.value("telemetryEnabled"));

const repo = hasDatabaseUrl
  ? createPrismaErrorsRepository(createDatabase(config.DATABASE_URL), {
      publicIngestOrigin: config.PUBLIC_INGEST_ORIGIN,
      consolePublicOrigin: config.CONSOLE_PUBLIC_ORIGIN,
    })
  : createInMemoryErrorsRepository({
      publicIngestOrigin: config.PUBLIC_INGEST_ORIGIN,
      consolePublicOrigin: config.CONSOLE_PUBLIC_ORIGIN,
      healthy: () => false,
    });

const mailClient =
  config.MAIL_API_URL === undefined || config.MAIL_API_TOKEN === undefined
    ? null
    : createMailOutboxClient({
        baseUrl: config.MAIL_API_URL,
        token: config.MAIL_API_TOKEN,
        from: config.MAIL_FROM,
        to: config.MAIL_TO,
      });

const trackerClient = createTrackerIssueClient({
  apiUrl: config.TRACKER_API_URL,
  publicUrl: config.TRACKER_PUBLIC_URL,
});

const metrics = createErrorsMetrics();
const sharedRateLimiter = createIngestRateLimiter();

let outboxFlushInFlight = false;
function triggerOutboxFlush(): void {
  if (outboxFlushInFlight || mailClient === null) {
    return;
  }
  outboxFlushInFlight = true;
  void (async () => {
    try {
      await dispatchPendingOutbox({
        repo,
        mail: mailClient,
        consolePublicOrigin: config.CONSOLE_PUBLIC_ORIGIN,
        emailNotificationsEnabled: () =>
          behavior.value("emailNotificationsEnabled"),
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          message: "errors_outbox_flush_failed",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    } finally {
      outboxFlushInFlight = false;
    }
  })();
}

const adminApp = createAdminApp({
  repo,
  trackerClient,
  trackerCreationEnabled: () => behavior.value("trackerCreationEnabled"),
  ingestEnabled: () => behavior.value("ingestEnabled"),
  rateLimiter: sharedRateLimiter,
  metrics,
  machineToken: config.ERRORS_MACHINE_TOKEN,
  consolePublicOrigin: config.CONSOLE_PUBLIC_ORIGIN,
  bugsinkImportUrl: config.BUGSINK_IMPORT_URL,
  bugsinkImportToken: config.BUGSINK_IMPORT_TOKEN,
  onOutboxQueued: triggerOutboxFlush,
});

const adminServer = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch: adminApp.fetch,
});

const ingestServer =
  config.ERRORS_INGEST_PORT === undefined
    ? undefined
    : Bun.serve({
        hostname: config.HOST,
        port: config.ERRORS_INGEST_PORT,
        fetch: createIngestApp({
          repo,
          ingestEnabled: () => behavior.value("ingestEnabled"),
          rateLimiter: sharedRateLimiter,
          metrics,
          onOutboxQueued: triggerOutboxFlush,
        }).fetch,
      });

console.warn(
  JSON.stringify({
    message: "errors_started",
    host: config.HOST,
    port: adminServer.port,
    ingestPort: ingestServer?.port ?? null,
  }),
);

void (async () => {
  try {
    const seededCount = await repo.seedCanonicalProjects();
    console.warn(
      JSON.stringify({
        message: "errors_canonical_projects_seeded",
        inserted: seededCount,
      }),
    );
    triggerOutboxFlush();
  } catch (error) {
    console.warn(
      JSON.stringify({
        message: "errors_canonical_projects_seed_failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
})();

async function shutdown(): Promise<void> {
  if (ingestServer !== undefined) {
    await ingestServer.stop();
  }
  await adminServer.stop();
  await repo.close();
  await shutdownFeatureFlags();
  await shutdownTelemetry();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
