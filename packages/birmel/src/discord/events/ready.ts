import type { Client } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { BOT_NAME } from "@shepherdjerred/birmel/config/constants.ts";

const logger = loggers.discord.child("ready");

export function setupReadyHandler(client: Client): void {
  client.once("clientReady", (readyClient) => {
    logger.info(`${BOT_NAME} is online!`, {
      username: readyClient.user.tag,
      guildCount: readyClient.guilds.cache.size,
    });
  });
}
