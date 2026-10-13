import { createWebServer as coreCreateWebServer } from "@shepherdjerred/discord-plays-core/webserver/server.ts";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { assertPathExists } from "#src/util.ts";
import { logger } from "#src/logger.ts";
import { createSocket } from "./socket.ts";

export function createWebServer({
  port,
  isCorsEnabled,
  isApiEnabled,
  webAssetsPath,
  publicOrigin,
}: {
  port: number;
  isCorsEnabled: boolean;
  isApiEnabled: boolean;
  webAssetsPath: string;
  publicOrigin: string | undefined;
}) {
  return coreCreateWebServer({
    port,
    isCorsEnabled,
    isApiEnabled,
    webAssetsPath,
    registry,
    logger,
    assertPathExists,
    createSocket: (args) => {
      if (publicOrigin === undefined)
        throw new Error("web API requires a public origin");
      return createSocket({ ...args, publicOrigin });
    },
  });
}
