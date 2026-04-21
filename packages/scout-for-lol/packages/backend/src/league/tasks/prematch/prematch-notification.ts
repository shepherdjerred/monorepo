import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { z } from "zod";
import type {
  RawCurrentGameInfo,
  PlayerConfigEntry,
  LeaguePuuid,
  DiscordGuildId,
  QueueType,
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
import { buildLoadingScreenData } from "#src/league/tasks/prematch/loading-screen-builder.ts";
import {
  loadingScreenToImage,
  loadingScreenToSvg,
} from "@scout-for-lol/report";
import {
  savePrematchDataToS3,
  savePrematchImageToS3,
  savePrematchSvgToS3,
} from "#src/storage/s3.ts";
import {
  prematchLoadingScreenGeneratedTotal,
  prematchLoadingScreenDurationSeconds,
} from "#src/metrics/index.ts";

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
 * Plain-text message paired with the loading-screen image.
 * Mirrors post-match's `formatGameCompletionMessage`: short, unformatted content
 * that renders above the image embed.
 */
function formatPrematchMessage(
  trackedPlayers: PlayerConfigEntry[],
  queueType: QueueType | undefined,
  gameMode: string,
): string {
  const queueName = queueType ? queueTypeToDisplayString(queueType) : gameMode;
  const validAliases = z
    .array(z.string().min(1))
    .parse(
      trackedPlayers
        .map((p) => p.alias)
        .filter((alias) => alias.trim().length > 0),
    );

  if (validAliases.length === 0) {
    return `Game started: ${queueName}`;
  }

  if (validAliases.length === 1) {
    return `${z.string().parse(validAliases[0])} started a ${queueName} game`;
  }

  if (validAliases.length === 2) {
    const first = z.string().parse(validAliases[0]);
    const second = z.string().parse(validAliases[1]);
    return `${first} and ${second} started a ${queueName} game`;
  }

  const allButLast = validAliases.slice(0, -1).join(", ");
  const last = z.string().parse(validAliases.at(-1));
  return `${allButLast}, and ${last} started a ${queueName} game`;
}

/**
 * Rich text embed used as a fallback when the loading-screen image cannot
 * be generated. Preserves the prior text-only notification experience.
 */
function buildFallbackPrematchEmbed(
  gameInfo: RawCurrentGameInfo,
  trackedPlayers: PlayerConfigEntry[],
): EmbedBuilder {
  const queueType = parseQueueType(gameInfo.gameQueueConfigId);
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
  const playerListText = formatPlayerList(aliases);

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

  const queueType = parseQueueType(gameInfo.gameQueueConfigId);
  const prematchMessageContent = formatPrematchMessage(
    trackedPlayers,
    queueType,
    gameInfo.gameMode,
  );

  // Generate loading screen image. Preferred delivery: image + short text.
  // If generation fails, we fall back to a rich text embed (buildFallbackPrematchEmbed).
  let loadingScreenAttachment: AttachmentBuilder | undefined;
  let loadingScreenEmbed: EmbedBuilder | undefined;
  try {
    const startTime = Date.now();
    const firstPlayer = trackedPlayers[0];
    if (firstPlayer === undefined) {
      throw new Error(`No tracked players provided for game ${gameId}`);
    }
    const region = firstPlayer.league.leagueAccount.region;
    const trackedPuuidSet = new Set(
      trackedPlayers.map((p) => p.league.leagueAccount.puuid),
    );

    const loadingScreenData = await buildLoadingScreenData(
      gameInfo,
      trackedPuuidSet,
      region,
    );

    const [image, svg] = await Promise.all([
      loadingScreenToImage(loadingScreenData),
      loadingScreenToSvg(loadingScreenData),
    ]);

    const attachmentName = `loading-screen-${gameId}.png`;
    loadingScreenAttachment = new AttachmentBuilder(Buffer.from(image)).setName(
      attachmentName,
    );
    loadingScreenEmbed = new EmbedBuilder({
      image: { url: `attachment://${attachmentName}` },
    });

    const duration = (Date.now() - startTime) / 1000;
    prematchLoadingScreenDurationSeconds.observe(duration);
    prematchLoadingScreenGeneratedTotal.inc({
      queue_type: queueType ?? "unknown",
      status: "success",
    });
    logger.info(
      `[sendPrematchNotification] 🖼️ Loading screen generated in ${duration.toFixed(1)}s for game ${gameId}`,
    );

    // Fire-and-forget S3 saves
    const aliases = trackedPlayers.map((p) => p.alias);
    void (async () => {
      try {
        await Promise.all([
          savePrematchDataToS3(gameInfo.gameId, gameInfo, aliases),
          savePrematchImageToS3(
            gameInfo.gameId,
            image,
            queueType ?? "unknown",
            aliases,
          ),
          savePrematchSvgToS3(
            gameInfo.gameId,
            svg,
            queueType ?? "unknown",
            aliases,
          ),
        ]);
      } catch (s3Error) {
        logger.error(
          `[sendPrematchNotification] Failed to save prematch assets to S3:`,
          s3Error,
        );
      }
    })();
  } catch (error) {
    prematchLoadingScreenGeneratedTotal.inc({
      queue_type: queueType ?? "unknown",
      status: "error",
    });
    logger.error(
      `[sendPrematchNotification] ❌ Failed to generate loading screen for game ${gameId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "prematch-loading-screen", gameId },
    });
    // Continue with text-only notification
  }

  for (const { channel } of channels) {
    try {
      const message =
        loadingScreenAttachment && loadingScreenEmbed
          ? {
              content: prematchMessageContent,
              files: [loadingScreenAttachment],
              embeds: [loadingScreenEmbed],
            }
          : { embeds: [buildFallbackPrematchEmbed(gameInfo, trackedPlayers)] };
      await send(message, channel);
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
