import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";

type HttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

type BackendStartupDependencies = {
  readonly validateChampionAssets: () => Promise<void>;
  readonly startHttpServer: () => Promise<HttpServerRuntime>;
  readonly startDiscord: () => Promise<void>;
};

export async function runBackendStartup(
  dependencies: BackendStartupDependencies,
): Promise<HttpServerRuntime> {
  await dependencies.validateChampionAssets();
  const httpServer = await dependencies.startHttpServer();
  await dependencies.startDiscord();
  return httpServer;
}

export async function startBackendRuntime(): Promise<HttpServerRuntime> {
  return runBackendStartup({
    validateChampionAssets,
    startHttpServer: async () => await import("#src/http-server.ts"),
    startDiscord: async () => {
      await import("@scout-for-lol/backend/discord/index.ts");
    },
  });
}
