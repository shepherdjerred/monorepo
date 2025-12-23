import type { Client } from "discord.js";
import { loggers } from "../../utils/logger.js";
import { BOT_NAME } from "../../config/constants.js";

const logger = loggers.discord.child("ready");

export function setupReadyHandler(client: Client): void {
  client.once("clientReady", (readyClient) => {
    logger.info(`${BOT_NAME} is online!`, {
      username: readyClient.user.tag,
      guildCount: readyClient.guilds.cache.size,
    });
  });
}
