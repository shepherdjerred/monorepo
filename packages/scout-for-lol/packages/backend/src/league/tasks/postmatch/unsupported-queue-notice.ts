import { EmbedBuilder, type MessageCreateOptions } from "discord.js";

/**
 * What subscribers read when a tracked player finishes a game in a queue Scout
 * cannot classify. One wording for the legacy generator and the notification
 * lane, so the two paths cannot tell users different things about one game.
 */
export function buildUnsupportedQueueMessage(game: {
  aliases: readonly string[];
  queueId: number;
  gameMode: string;
}): MessageCreateOptions {
  const embed = new EmbedBuilder()
    .setTitle("Game type not supported yet")
    .setDescription(
      `${game.aliases.join(", ")} finished a game in queue ${game.queueId.toString()} (${game.gameMode}). ` +
        `Scout does not support reports for this mode yet, but the game was recorded.`,
    );
  return { embeds: [embed] };
}
