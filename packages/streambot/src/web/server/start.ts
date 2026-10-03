import path from "node:path";
import type { WebBootstrap } from "./auth.ts";
import { WebSessionStore } from "./session-store.ts";
import { WebPlayback, type WebPlaybackDeps } from "./playback.ts";
import { createWebHandler } from "./api.ts";

export function serveWebHandler(
  port: number,
  handler: (request: Request) => Promise<Response>,
) {
  return Bun.serve({
    hostname: "0.0.0.0",
    port,
    maxRequestBodySize: 16 * 1024,
    // Catalog requests have a 30-second deadline plus browser-tab cleanup.
    // Bun's default 10-second idle timeout otherwise resets them mid-request.
    idleTimeout: 40,
    fetch: handler,
  });
}

export async function startWebServer(deps: {
  bootstrap: WebBootstrap;
  stateDir: string;
  playback: WebPlaybackDeps;
  applicationId: () => string;
}) {
  const assetsDir = path.resolve(import.meta.dirname, "../../..", "dist/web");
  if (!(await Bun.file(path.join(assetsDir, "index.html")).exists()))
    throw new Error("Streambot web assets are missing. Run bun run build.");
  const store = new WebSessionStore(
    path.join(deps.stateDir, "streambot-web.sqlite"),
  );
  const handler = createWebHandler({
    bootstrap: deps.bootstrap,
    store,
    playback: new WebPlayback(deps.playback),
    applicationId: deps.applicationId,
    assetsDir,
  });
  const server = serveWebHandler(deps.bootstrap.port, handler);
  return {
    stop: async () => {
      await server.stop(true);
      store.close();
    },
  };
}
