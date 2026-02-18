import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/index.ts";

const logger = loggers.scheduler.child("elections").child("nickname");

export async function updateBotNickname(
  guildId: string,
  nickname: string,
): Promise<void> {
  try {
    const client = getDiscordClient();
    const guild = await client.guilds.fetch(guildId);
    await guild.members.me?.setNickname(nickname);
    logger.info("Bot nickname updated", { guildId, nickname });
  } catch (error) {
    logger.error("Failed to update bot nickname", error, { guildId, nickname });
    // Don't throw - election should continue even if nickname fails
  }
}
