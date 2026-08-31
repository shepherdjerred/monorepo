import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";
import configuration from "#src/configuration.ts";
import { temporalCallGraphTracing } from "#src/config/dynamic.ts";
import { createLogger } from "#src/logger.ts";
import type { ScoutTemporalSupervisor } from "#src/temporal/supervisor.ts";

const logger = createLogger("startup");

type HttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

type BackendStartupDependencies = {
  readonly validateChampionAssets: () => Promise<void>;
  readonly ensureReportLakeReady?: () => Promise<void>;
  readonly startHttpServer: () => Promise<HttpServerRuntime>;
  readonly startDiscord: () => Promise<void>;
  readonly startTemporalCore?: () => Promise<void>;
  readonly startTemporalDiscordWorkers?: () => void | Promise<void>;
};

export async function runBackendStartup(
  dependencies: BackendStartupDependencies,
): Promise<HttpServerRuntime> {
  await dependencies.validateChampionAssets();
  if (dependencies.ensureReportLakeReady !== undefined) {
    await dependencies.ensureReportLakeReady();
  }
  if (dependencies.startTemporalCore !== undefined) {
    await dependencies.startTemporalCore();
  }
  // Discord connects before the HTTP server accepts traffic. Authorization
  // paths read the live guild cache, and an unready cache is indistinguishable
  // from "Scout is not installed" at several call sites — so serving while the
  // gateway is still connecting hands out false NOT_FOUNDs to real members.
  // This ordering used to be implicit: the client module logged in from a
  // top-level await, which the HTTP server pulled in through its tRPC routers.
  await dependencies.startDiscord();
  if (dependencies.startTemporalDiscordWorkers !== undefined) {
    await dependencies.startTemporalDiscordWorkers();
  }
  const httpServer = await dependencies.startHttpServer();
  return httpServer;
}

export async function startBackendRuntime(): Promise<
  HttpServerRuntime & {
    readonly shutdownTemporal: () => Promise<void>;
    readonly shutdownDiscord: () => Promise<void>;
  }
> {
  let temporalSupervisor: ScoutTemporalSupervisor | undefined;
  const httpRuntime = await runBackendStartup({
    validateChampionAssets,
    ensureReportLakeReady: async () => {
      if (!configuration.enableBackgroundJobs) {
        return;
      }
      const { runReportLakeFold } =
        await import("#src/report-lake/compactor.ts");
      await runReportLakeFold();
    },
    startHttpServer: async () => await import("#src/http/server.ts"),
    startTemporalCore: async () => {
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
        legacyNamespace: configuration.temporalLegacyNamespace,
        stage: configuration.environment,
        activities: createScoutTemporalActivityGroups(),
        callGraphTracing: temporalCallGraphTracing(),
      });
      const { setScoutTemporalSupervisor } =
        await import("#src/temporal/runtime.ts");
      setScoutTemporalSupervisor(temporalSupervisor);
    },
    startDiscord: async () => {
      if (Bun.env.NODE_ENV === "test") {
        return;
      }
      if (!configuration.enableDiscordGateway) {
        logger.warn(
          "⏭️  Discord gateway disabled for this local secondary instance",
        );
        return;
      }
      await import("@scout-for-lol/backend/discord/index.ts");
    },
    startTemporalDiscordWorkers: async () => {
      if (configuration.enableDiscordGateway) {
        temporalSupervisor?.enableDiscordWorkers();
        if (temporalSupervisor !== undefined) {
          try {
            const { triggerScoutIngestionReconciliationSchedule } =
              await import("#src/temporal/starts.ts");
            await triggerScoutIngestionReconciliationSchedule(
              temporalSupervisor.client(),
              configuration.environment,
            );
          } catch (error: unknown) {
            logger.warn(
              "Temporal gateway-ready reconciliation signal was not accepted; the fixed reconciliation Schedule will retry",
              { error },
            );
          }
        }
      }
    },
  });
  return {
    ...httpRuntime,
    shutdownTemporal: async () => {
      const { setScoutTemporalSupervisor } =
        await import("#src/temporal/runtime.ts");
      setScoutTemporalSupervisor(undefined);
      await temporalSupervisor?.shutdown();
    },
    shutdownDiscord: async () => {
      const { stopDiscordGateway } = await import("#src/discord/bootstrap.ts");
      stopDiscordGateway();
    },
  };
}
