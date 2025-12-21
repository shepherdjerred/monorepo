import type { Client, Guild } from "discord.js";
import { logger } from "../../utils/logger.js";

export function setupGuildCreateHandler(client: Client): void {
  client.on("guildCreate", (guild: Guild) => {
    logger.info("Joined new guild", {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount,
    });
  });
}
