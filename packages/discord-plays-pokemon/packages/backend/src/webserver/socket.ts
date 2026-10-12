import type http from "node:http";
import { DRIVER_FEED_PATH } from "@shepherdjerred/discord-plays-core/driver-feed/protocol.ts";
import {
  createGameSocket,
  type GameSocketChannel,
} from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import { RequestSchema, type Request } from "@discord-plays-pokemon/common";
import { logger } from "#src/logger.ts";

type SocketChannel = GameSocketChannel<Request>;

export function createSocket({
  server,
  isCorsEnabled,
}: {
  server: http.Server;
  isCorsEnabled: boolean;
}): SocketChannel {
  return createGameSocket({
    server,
    isCorsEnabled,
    requestSchema: RequestSchema,
    ownedUpgradePaths: [DRIVER_FEED_PATH],
    // Commands arrive per keypress.
    quietKinds: ["command"],
    logger,
  });
}
