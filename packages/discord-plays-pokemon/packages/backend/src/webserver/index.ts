import { createWebServer as coreCreateWebServer } from "@shepherdjerred/discord-plays-core/webserver/server.ts";
import { registry } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { assertPathExists } from "#src/util.ts";
import { logger } from "#src/logger.ts";
import { createSocket } from "./socket.ts";
import type { IdentifySocket } from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

export function createWebServer({
  port,
  isCorsEnabled,
  isApiEnabled,
  webAssetsPath,
  identify,
  publicOrigin,
}: {
  port: number;
  isCorsEnabled: boolean;
  isApiEnabled: boolean;
  webAssetsPath: string;
  identify: IdentifySocket<DiscordUser>;
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
        throw new Error("web API requires an auth origin");
      return createSocket({ ...args, identify, publicOrigin });
    },
  });
}
