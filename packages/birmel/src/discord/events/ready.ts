import type { Client } from "discord.js";
import { logger } from "../../utils/logger.js";
import { BOT_NAME } from "../../config/constants.js";

export function setupReadyHandler(client: Client): void {
  // Use string "ready" - the deprecation warning is acceptable
  // Events.ClientReady causes module resolution issues in some Bun versions
  client.once("ready", (readyClient) => {
    logger.info(`${BOT_NAME} is online!`, {
      username: readyClient.user.tag,
      guildCount: readyClient.guilds.cache.size,
    });
  });
}
