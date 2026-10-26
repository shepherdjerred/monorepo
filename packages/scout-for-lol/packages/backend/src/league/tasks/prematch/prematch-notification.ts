import { formatPlayerList } from "#src/league/tasks/prematch/prematch-copy.ts";
import { getChampionDisplayName } from "#src/utils/champion.ts";
import type {
  PlayerConfigEntry,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import {
  queueTypeToDisplayString,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data/index.ts";
import {
  EmbedBuilder,
  type AttachmentBuilder,
  type MessageCreateOptions,
} from "discord.js";

const PREMATCH_EMBED_COLOR = 0x00_bc_d4; // Teal - distinct from post-match

/**
 * Rich text embed used as a fallback when the loading-screen image cannot
 * be generated. Preserves the prior text-only notification experience.
 */
export function buildFallbackPrematchEmbed(
  gameInfo: RawCurrentGameInfo,
  trackedPlayers: PlayerConfigEntry[],
): EmbedBuilder {
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  const queueName = queueType
    ? queueTypeToDisplayString(queueType)
    : gameInfo.gameMode;

  const playerDetails = trackedPlayers.map((player) => {
    const participant = gameInfo.participants.find(
      (p) => p.puuid === player.league.leagueAccount.puuid,
    );
    const championName = participant
      ? getChampionDisplayName(participant.championId)
      : "Unknown";
    return { alias: player.alias, championName };
  });

  const aliases = playerDetails.map((p) => `**${p.alias}**`);
  const article = queueName === "arena" ? "an" : "a";
  const title = `🎮 ${formatPlayerList(aliases)} started ${article} ${queueName} game`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(PREMATCH_EMBED_COLOR)
    .setTimestamp(
      gameInfo.gameStartTime > 0
        ? new Date(gameInfo.gameStartTime)
        : new Date(),
    );

  const championLines = playerDetails.map(
    (p) => `**${p.alias}** — ${p.championName}`,
  );
  embed.setDescription(championLines.join("\n"));

  embed.addFields({ name: "Mode", value: queueName, inline: true });

  return embed;
}

/**
 * The message payload for one channel.
 *
 * "What does this message look like" is a separate question from "where does
 * it go", which the notification Workflow answers.
 */
export function buildPrematchPayload(input: {
  baseContent: string;
  loadingScreenAttachment: AttachmentBuilder | undefined;
  loadingScreenEmbed: EmbedBuilder | undefined;
  fallbackEmbed: () => EmbedBuilder;
}): MessageCreateOptions {
  if (input.loadingScreenAttachment && input.loadingScreenEmbed)
    return {
      content: input.baseContent,
      files: [input.loadingScreenAttachment],
      embeds: [input.loadingScreenEmbed],
    };
  return { embeds: [input.fallbackEmbed()] };
}
