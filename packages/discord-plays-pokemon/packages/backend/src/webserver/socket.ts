import type http from "node:http";
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
    ownedUpgradePaths: [],
    // Commands arrive per keypress.
    quietKinds: ["command"],
    logger,
  });
}
