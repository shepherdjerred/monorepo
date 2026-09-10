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
  readonly bootstrapVoiceAssistant?: () => Promise<void>;
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
  // Fatal when voice is enabled and the pinned assets fail verification, a
  // deliberate boot gate exactly like the champion assets above — and before
  // Discord starts, so a voice-enabled pod is never briefly reachable while
  // half-deaf.
  if (dependencies.bootstrapVoiceAssistant !== undefined) {
    await dependencies.bootstrapVoiceAssistant();
  }
  if (dependencies.ensureReportLakeReady !== undefined) {
    await dependencies.ensureReportLakeReady();
  }
  if (dependencies.startTemporalCore !== undefined) {
    await dependencies.startTemporalCore();
  }
  // Discord connects before the HTTP server accepts traffic.
  //
  // The original reason no longer holds: web-serving code used to read the live
  // guild cache, where an unready cache was indistinguishable from "Scout is not
  // installed", so serving during connect handed real members false NOT_FOUNDs.
  // Those paths now go through the `installed-guilds` / `bot-rest` ports and are
  // independent of gateway state (see the backend README).
  //
  // The ordering is kept as-is here rather than relaxed opportunistically: the
  // gateway-owning process still wants its shard up before it takes traffic, and
  // separating the HTTP and gateway roles is its own change.
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
    readonly shutdownVoiceAssistant: () => Promise<void>;
  }
> {
  let temporalSupervisor: ScoutTemporalSupervisor | undefined;
  const httpRuntime = await runBackendStartup({
    validateChampionAssets,
    bootstrapVoiceAssistant: async () => {
      const { bootstrapVoiceAssistant } =
        await import("#src/voice-assistant/runtime.ts");
      await bootstrapVoiceAssistant();
    },
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
        logger.warn("⏭️  Discord gateway disabled for this local instance");
        return;
      }
      await import("@scout-for-lol/backend/discord/index.ts");
    },
    startTemporalDiscordWorkers: async () => {
      if (configuration.enableDiscordGateway) {
        temporalSupervisor?.enableDiscordWorkers();
        if (temporalSupervisor !== undefined) {
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
    // Ends every active Hey Scout session: aborts in-flight Realtime turns,
    // closes receiver streams, cancels inactivity timers, and records the
    // "shutdown" lifecycle reason. Called separately from `shutdownDiscord`
    // (and by the caller, before it) so a session cannot keep receiving
    // audio and running OpenAI turns through the rest of the drain.
    shutdownVoiceAssistant: async () => {
      const { getVoiceAssistantManager } =
        await import("#src/voice-assistant/manager.ts");
      getVoiceAssistantManager().closeAll();
    },
  };
}
