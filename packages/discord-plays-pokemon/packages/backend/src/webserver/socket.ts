import type http from "node:http";
import { DRIVER_FEED_PATH } from "@shepherdjerred/discord-plays-core/driver-feed/protocol.ts";
import {
  createGameSocket,
  type GameSocketChannel,
  type IdentifySocket,
} from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import { RequestSchema, type Request } from "@discord-plays-pokemon/common";
import { logger } from "#src/logger.ts";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

type SocketChannel = GameSocketChannel<Request, DiscordUser>;

export function createSocket({
  server,
  isCorsEnabled,
  identify,
  publicOrigin,
}: {
  server: http.Server;
  isCorsEnabled: boolean;
  identify: IdentifySocket<DiscordUser>;
  publicOrigin: string;
}): SocketChannel {
  return createGameSocket({
    server,
    isCorsEnabled,
    identify,
    allowedOrigin: publicOrigin,
    requestSchema: RequestSchema,
    ownedUpgradePaths: [DRIVER_FEED_PATH],
    // Commands arrive per keypress.
    quietKinds: ["command"],
    logger,
  });
}
