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
  // Discord connects before the HTTP server accepts traffic. Authorization
  // paths read the live guild cache, and an unready cache is indistinguishable
  // from "Scout is not installed" at several call sites — so serving while the
  // gateway is still connecting hands out false NOT_FOUNDs to real members.
  // This ordering used to be implicit: the client module logged in from a
  // top-level await, which the HTTP server pulled in through its tRPC routers.
  await dependencies.startDiscord();
  const httpServer = await dependencies.startHttpServer();
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
    startHttpServer: async () => await import("#src/http/server.ts"),
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
  });
}
