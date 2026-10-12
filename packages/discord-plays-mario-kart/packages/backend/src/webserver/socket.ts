import type http from "node:http";
import {
  createGameSocket,
  type GameSocketChannel,
  type IdentifySocket,
} from "@shepherdjerred/discord-plays-core/webserver/socket.ts";
import { DRIVER_FEED_PATH } from "@shepherdjerred/discord-plays-core/driver-feed/protocol.ts";
import {
  RequestSchema,
  type DiscordUser,
  type Request,
} from "@discord-plays-mario-kart/common";
import { logger } from "#src/logger.ts";

type SocketChannel = GameSocketChannel<Request, DiscordUser>;

export function createSocket({
  server,
  isCorsEnabled,
  identify,
}: {
  server: http.Server;
  isCorsEnabled: boolean;
  identify: IdentifySocket<DiscordUser>;
}): SocketChannel {
  return createGameSocket({
    server,
    isCorsEnabled,
    requestSchema: RequestSchema,
    ownedUpgradePaths: [DRIVER_FEED_PATH],
    // Input arrives per keypress and latency reports every 2s per client.
    quietKinds: ["input", "latency-report"],
    identify,
    logger,
  });
}
