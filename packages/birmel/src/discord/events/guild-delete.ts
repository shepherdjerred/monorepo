import type { Client, Guild } from "discord.js";
import { logger } from "../../utils/logger.js";

export function setupGuildDeleteHandler(client: Client): void {
  client.on("guildDelete", (guild: Guild) => {
    logger.info("Left guild", {
      guildId: guild.id,
      guildName: guild.name,
    });
  });
}
