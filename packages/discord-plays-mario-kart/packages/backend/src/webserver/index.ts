import { createWebServer as coreCreateWebServer } from "@shepherdjerred/discord-plays-core/webserver/server.ts";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { assertPathExists } from "#src/util.ts";
import { logger } from "#src/logger.ts";
import { createSocket, type IdentifySocket } from "./socket.ts";

export function createWebServer({
  port,
  isCorsEnabled,
  isApiEnabled,
  webAssetsPath,
  identify,
}: {
  port: number;
  isCorsEnabled: boolean;
  isApiEnabled: boolean;
  webAssetsPath: string;
  identify: IdentifySocket;
}) {
  return coreCreateWebServer({
    port,
    isCorsEnabled,
    isApiEnabled,
    webAssetsPath,
    registry,
    logger,
    assertPathExists,
    createSocket: (args) => createSocket({ ...args, identify }),
  });
}
