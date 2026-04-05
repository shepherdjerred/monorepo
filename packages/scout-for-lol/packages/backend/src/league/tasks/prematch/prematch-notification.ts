import { EmbedBuilder } from "discord.js";
import type {
  RawCurrentGameInfo,
  PlayerConfigEntry,
  LeaguePuuid,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import {
  parseQueueType,
  queueTypeToDisplayString,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/index.ts";
import { send, ChannelSendError } from "#src/league/discord/channel.ts";
import { getChampionDisplayName } from "#src/utils/champion.ts";
import { createLogger } from "#src/logger.ts";
import { uniqueBy } from "remeda";
import * as Sentry from "@sentry/bun";

const logger = createLogger("prematch-notification");

const PREMATCH_EMBED_COLOR = 0x00_bc_d4; // Teal - distinct from post-match

/**
 * Format a natural language list: "A", "A and B", "A, B, and C"
 */
function formatPlayerList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0] ?? ""} and ${names[1] ?? ""}`;
  const allButLast = names.slice(0, -1).join(", ");
  const last = names.at(-1) ?? "";
  return `${allButLast}, and ${last}`;
}

/**
 * Build a Discord embed for a pre-match notification.
 */
function buildPrematchEmbed(
  gameInfo: RawCurrentGameInfo,
  trackedPlayers: PlayerConfigEntry[],
): EmbedBuilder {
  const queueType = parseQueueType(gameInfo.gameQueueConfigId);
  const queueName = queueType
    ? queueTypeToDisplayString(queueType)
    : gameInfo.gameMode;

  // Match each tracked player to their participant data
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
  const playerListText = formatPlayerList(aliases);

  // Title varies by player count
  const title =
    trackedPlayers.length === 1
      ? `🎮 ${trackedPlayers[0]?.alias ?? "Player"} started a ${queueName} game`
      : `🎮 ${playerListText} started a ${queueName} game`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(PREMATCH_EMBED_COLOR)
    .setTimestamp(
      gameInfo.gameStartTime > 0
        ? new Date(gameInfo.gameStartTime)
        : new Date(),
    );

  // Add champion details
  const championLines = playerDetails.map(
    (p) => `**${p.alias}** — ${p.championName}`,
  );
  embed.setDescription(championLines.join("\n"));

  embed.addFields({ name: "Mode", value: queueName, inline: true });

  return embed;
}

/**
 * Send pre-match notifications to all subscribed Discord channels.
 */
export async function sendPrematchNotification(
  gameInfo: RawCurrentGameInfo,
  trackedPlayers: PlayerConfigEntry[],
): Promise<void> {
  const gameId = gameInfo.gameId.toString();
  logger.info(
    `[sendPrematchNotification] 📢 Sending notification for game ${gameId} with ${trackedPlayers.length.toString()} tracked player(s)`,
  );

  const puuids: LeaguePuuid[] = trackedPlayers.map(
    (p) => p.league.leagueAccount.puuid,
  );
  const channels = await getChannelsSubscribedToPlayers(puuids);

  if (channels.length === 0) {
    logger.info(
      `[sendPrematchNotification] ⚠️  No channels subscribed for game ${gameId}`,
    );
    return;
  }

  const targetGuildIds: DiscordGuildId[] = uniqueBy(
    channels.map((c) => DiscordGuildIdSchema.parse(c.serverId)),
    (id) => id,
  );

  logger.info(
    `[sendPrematchNotification] 📺 Sending to ${channels.length.toString()} channel(s) across ${targetGuildIds.length.toString()} guild(s)`,
  );

  const embed = buildPrematchEmbed(gameInfo, trackedPlayers);

  for (const { channel } of channels) {
    try {
      await send({ embeds: [embed] }, channel);
    } catch (error) {
      if (error instanceof ChannelSendError && error.permissionError) {
        logger.warn(
          `[sendPrematchNotification] ⚠️  Permission error for channel ${channel}: ${error.message}`,
        );
        continue;
      }
      logger.error(
        `[sendPrematchNotification] ❌ Failed to send to channel ${channel}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "prematch-notification", gameId, channel },
      });
    }
  }

  logger.info(
    `[sendPrematchNotification] ✅ Notifications sent for game ${gameId}`,
  );
}
