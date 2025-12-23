import type { Client, Guild } from "discord.js";
import { loggers } from "../../utils/logger.js";

const logger = loggers.discord.child("guild-create");

export function setupGuildCreateHandler(client: Client): void {
  client.on("guildCreate", (guild: Guild) => {
    logger.info("Joined new guild", {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount,
    });
  });
}
