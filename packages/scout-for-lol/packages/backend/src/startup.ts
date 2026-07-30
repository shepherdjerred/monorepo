import { ensureClassicFontsConfigured } from "#src/league/classic-fonts.ts";
import { validateChampionAssets } from "#src/league/data-dragon/validate-assets.ts";

type HttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

type BackendStartupDependencies = {
  readonly validateChampionAssets: () => Promise<void>;
  readonly ensureClassicFontsConfigured: () => Promise<void>;
  readonly startHttpServer: () => Promise<HttpServerRuntime>;
  readonly startDiscord: () => Promise<void>;
};

export async function runBackendStartup(
  dependencies: BackendStartupDependencies,
): Promise<HttpServerRuntime> {
  await dependencies.validateChampionAssets();
  await dependencies.ensureClassicFontsConfigured();
  const httpServer = await dependencies.startHttpServer();
  await dependencies.startDiscord();
  return httpServer;
}

export async function startBackendRuntime(): Promise<HttpServerRuntime> {
  return runBackendStartup({
    validateChampionAssets,
    ensureClassicFontsConfigured,
    startHttpServer: async () => await import("#src/http-server.ts"),
    startDiscord: async () => {
      await import("@scout-for-lol/backend/discord/index.ts");
    },
  });
}
