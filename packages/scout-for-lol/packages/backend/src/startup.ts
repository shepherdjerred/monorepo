import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("startup");

type HttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

type BackendStartupDependencies = {
  readonly validateChampionAssets: () => Promise<void>;
  readonly ensureReportLakeReady?: () => Promise<void>;
  readonly startHttpServer: () => Promise<HttpServerRuntime>;
  readonly startDiscord: () => Promise<void>;
};

export async function runBackendStartup(
  dependencies: BackendStartupDependencies,
): Promise<HttpServerRuntime> {
  await dependencies.validateChampionAssets();
  if (dependencies.ensureReportLakeReady !== undefined) {
    await dependencies.ensureReportLakeReady();
  }
  const httpServer = await dependencies.startHttpServer();
  await dependencies.startDiscord();
  return httpServer;
}

export async function startBackendRuntime(): Promise<HttpServerRuntime> {
  return runBackendStartup({
    validateChampionAssets,
    ensureReportLakeReady: async () => {
      if (!configuration.enableBackgroundJobs) {
        return;
      }
      const { runReportLakeFold } =
        await import("#src/report-lake/compactor.ts");
      await runReportLakeFold();
    },
    startHttpServer: async () => await import("#src/http-server.ts"),
    startDiscord: async () => {
      if (!configuration.enableDiscordGateway) {
        logger.warn(
          "⏭️  Discord gateway disabled for this local secondary instance",
        );
        return;
      }
      await import("@scout-for-lol/backend/discord/index.ts");
    },
  });
}
