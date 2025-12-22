import { Events, type Client } from "discord.js";
import { logger } from "../../utils/logger.js";
import { BOT_NAME } from "../../config/constants.js";

export function setupReadyHandler(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`${BOT_NAME} is online!`, {
      username: readyClient.user.tag,
      guildCount: readyClient.guilds.cache.size,
    });
  });
}
