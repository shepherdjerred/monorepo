/**
 * The real implementation of every runtime step, for every role.
 *
 * One object, built once per process, holding the handles the boot steps create
 * and the shutdown steps release. The heavy modules are behind dynamic imports
 * exactly as they were in the previous `startup.ts`: a role that does not run a
 * subsystem must not pay to load it, and `application` in particular must not
 * pull the voice pipeline or the gateway bootstrap into its module graph.
 */

import configuration from "#src/configuration.ts";
import {
  scoutRuntimeCapabilities,
  type ScoutRuntimeRole,
} from "#src/configuration/runtime-role.ts";
import { temporalCallGraphTracing } from "#src/config/dynamic.ts";
import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";
import { createLogger } from "#src/logger.ts";
import { setDatabaseMetricSweepsEnabled } from "#src/metrics/sweep-policy.ts";
import { setDiscordGatewayState } from "#src/metrics/platform/discord-gateway-health.ts";
import type { ScoutRuntimeDependencies } from "#src/runtime/boot.ts";
import type { ScoutTemporalSupervisor } from "#src/temporal/supervisor.ts";

const logger = createLogger("runtime-subsystems");

type HttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

type CompetitionActivityWorker = {
  readonly shutdown: () => Promise<void>;
};

/**
 * Build the production dependency set for one role.
 *
 * The mutable handles are closed over rather than returned, because the boot
 * and shutdown halves of a subsystem are separate steps in separate ordered
 * lists and both need to reach the same object.
 */
export function scoutRuntimeSubsystems(
  role: ScoutRuntimeRole,
): ScoutRuntimeDependencies {
  const capabilities = scoutRuntimeCapabilities(role);
  let temporalSupervisor: ScoutTemporalSupervisor | undefined;
  let httpServer: HttpServerRuntime | undefined;
  let competitionWorker: CompetitionActivityWorker | undefined;

  return {
    configureMetricSweeps: setDatabaseMetricSweepsEnabled,

    prepareDiscord: async ({ ownsGateway }) => {
      const { authorizeDiscordRest } =
        await import("#src/discord/rest-identity.ts");
      authorizeDiscordRest();
      if (ownsGateway) return;
      // Say "there is deliberately no shard here" before the liveness probe can
      // ask. Left at its initial `connecting`, this pod would start failing
      // `/livez` the moment the startup grace period ended.
      setDiscordGatewayState("disabled");
    },

    boot: {
      "champion-assets": validateChampionAssets,

      "voice-assistant": async () => {
        const { bootstrapVoiceAssistant } =
          await import("#src/voice-assistant/runtime.ts");
        await bootstrapVoiceAssistant();
      },

      /**
       * Settle the report lake for this role: fold it, or verify someone else
       * did.
       *
       * `SCOUT_DEV_SKIP_REPORT_LAKE_FOLD` skips the *fold* — the step a laptop
       * with no S3 bucket cannot complete — and deliberately no longer skips
       * the check that a build exists. Skipping both is what let a dev-skip
       * process serve an unpublished lake in total silence, which is the exact
       * failure the gate was written to make loud.
       *
       * The gate is downgraded rather than given a second environment
       * variable, because a second variable would be one nobody sets: dev-web
       * only ever runs `combined` or `application`, both of which fold, so the
       * refusing branch is not on its path at all. The only way a developer
       * reaches the gate is by explicitly asking for a reader role locally,
       * where refusing to boot would defeat the fold flag's whole purpose. In
       * dev-skip mode an unpublished lake therefore logs a warning naming the
       * consequence; outside dev the flag cannot be set (`configuration.ts`
       * throws), so every deployed pod keeps the refusal unconditionally.
       */
      "report-lake": async () => {
        const { assertPublishedReportLake } =
          await import("#src/runtime/report-lake-gate.ts");
        if (configuration.skipReportLakeFold) {
          logger.warn(
            "⏭️  Skipping the boot report-lake fold (SCOUT_DEV_SKIP_REPORT_LAKE_FOLD)",
          );
          await assertPublishedReportLake({ onUnpublished: "warn" });
          return;
        }
        if (capabilities.reportLakeFold) {
          const { runReportLakeFold } =
            await import("#src/report-lake/compactor.ts");
          await runReportLakeFold();
          return;
        }
        await assertPublishedReportLake({ onUnpublished: "refuse" });
      },

      "temporal-core": async () => {
        const [
          { startScoutTemporalSupervisor },
          { createScoutTemporalActivityGroups },
        ] = await Promise.all([
          import("#src/temporal/supervisor.ts"),
          import("#src/temporal/activities.ts"),
        ]);
        temporalSupervisor = startScoutTemporalSupervisor({
          address: configuration.temporalAddress,
          namespace: configuration.temporalNamespace,
          stage: configuration.environment,
          activities: createScoutTemporalActivityGroups(),
          callGraphTracing: temporalCallGraphTracing(),
          workers: capabilities.temporalWorkers,
          deferredWorkers: capabilities.deferredTemporalWorkers,
        });
        const { setScoutTemporalSupervisor } =
          await import("#src/temporal/runtime.ts");
        setScoutTemporalSupervisor(temporalSupervisor);
      },

      "discord-gateway": async () => {
        if (Bun.env.NODE_ENV === "test") return;
        await import("@scout-for-lol/backend/discord/index.ts");
      },

      "temporal-deferred-workers": async () => {
        temporalSupervisor?.enableDeferredWorkers();
        await Promise.resolve();
      },

      "gateway-ready-reconciliation": async () => {
        if (temporalSupervisor === undefined) return;
        try {
          const { startScoutGatewayReadyIngestionReconciliation } =
            await import("#src/temporal/starts.ts");
          await startScoutGatewayReadyIngestionReconciliation(
            temporalSupervisor.client(),
            configuration.environment,
          );
        } catch (error: unknown) {
          logger.warn(
            "Temporal gateway-ready reconciliation start was not accepted; the fixed reconciliation Schedule will retry",
            { error },
          );
        }
      },

      "http-server": async () => {
        if (capabilities.httpSurface === "admin") {
          const { startAdminHttpServer } =
            await import("#src/http/admin-server.ts");
          httpServer = startAdminHttpServer();
          return;
        }
        httpServer = await import("#src/http/server.ts");
      },

      "competition-worker": async () => {
        const { startScoutCompetitionActivityWorker } =
          await import("#src/league/tasks/competition/temporal-worker.ts");
        competitionWorker = await startScoutCompetitionActivityWorker();
      },

      "database-seeding": async () => {
        const [
          { prisma },
          { seedSeasons },
          { seedScheduledReportLastSuccessMetric },
        ] = await Promise.all([
          import("#src/database/index.ts"),
          import("#src/database/season-seeder.ts"),
          import("#src/reports/schedule/schedule-metric-seed.ts"),
        ]);
        logger.info("🌱 Seeding Season table from SEASONS constant");
        await seedSeasons(prisma);
        logger.info("📈 Seeding scheduled-report freshness gauge from DB");
        await seedScheduledReportLastSuccessMetric(prisma);
      },
    },

    shutdown: {
      // First: aborts every in-flight Realtime turn and stops audio receipt for
      // any active Hey Scout session. Everything below can otherwise take long
      // enough (Temporal drain, HTTP drain) that a session would keep receiving
      // audio and running OpenAI turns through the whole sequence.
      "voice-assistant": async () => {
        const { getVoiceAssistantManager } =
          await import("#src/voice-assistant/manager.ts");
        getVoiceAssistantManager().closeAll();
      },

      temporal: async () => {
        const { setScoutTemporalSupervisor } =
          await import("#src/temporal/runtime.ts");
        setScoutTemporalSupervisor(undefined);
        await temporalSupervisor?.shutdown();
      },

      "competition-worker": async () => {
        await competitionWorker?.shutdown();
      },

      "http-server": async () => {
        await httpServer?.shutdownHttpServer();
      },

      "discord-gateway": async () => {
        const { stopDiscordGateway } =
          await import("#src/discord/bootstrap.ts");
        stopDiscordGateway();
      },

      // Stops the config poller before analytics flushes, so a refresh cannot
      // race the exit.
      "dynamic-config": async () => {
        const { shutdownDynamicConfig } =
          await import("#src/config/dynamic.ts");
        await shutdownDynamicConfig();
      },

      "product-analytics": async () => {
        const { shutdownProductAnalytics } =
          await import("#src/analytics/product-analytics.ts");
        await shutdownProductAnalytics();
      },

      database: async () => {
        const { prisma } = await import("#src/database/index.ts");
        await prisma.$disconnect();
      },
    },
  };
}
