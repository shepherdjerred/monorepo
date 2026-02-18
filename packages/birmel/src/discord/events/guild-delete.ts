import type { Client, Guild } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";

const logger = loggers.discord.child("guild-delete");

export function setupGuildDeleteHandler(client: Client): void {
  client.on("guildDelete", (guild: Guild) => {
    logger.info("Left guild", {
      guildId: guild.id,
      guildName: guild.name,
    });
  });
}
