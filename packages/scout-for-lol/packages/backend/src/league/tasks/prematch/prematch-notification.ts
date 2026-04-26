import { AttachmentBuilder, EmbedBuilder } from "discord.js";
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
  prematchLoadingScreenSkinFallbackTotal,
} from "#src/metrics/index.ts";
import type { SkinFallbackEvent } from "@scout-for-lol/data/index.ts";

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
  const aliases = trackedPlayers
    .map((p) => p.alias)
    .filter((alias) => alias.trim().length > 0);
  if (aliases.length === 0) {
    return `Game started: ${queueName}`;
  }
  return `${formatPlayerList(aliases)} started a ${queueName} game`;
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
  const title = `🎮 ${formatPlayerList(aliases)} started a ${queueName} game`;

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
  const aliases = trackedPlayers.map((p) => p.alias);
  logger.info(
    `[sendPrematchNotification] 📢 Sending notification for game ${gameId} with ${trackedPlayers.length.toString()} tracked player(s)`,
  );

  const prematchPayloadSave = await savePrematchDataToS3(
    gameInfo.gameId,
    gameInfo,
    aliases,
  );
  if (prematchPayloadSave.status === "error") {
    logger.warn(
      `[sendPrematchNotification] ⚠️  Failed to persist spectator payload to S3 for game ${gameId}; continuing with notification delivery`,
    );
  } else if (prematchPayloadSave.status === "skipped_no_bucket") {
    logger.info(
      `[sendPrematchNotification] ℹ️  S3 disabled; spectator payload not persisted for game ${gameId}`,
    );
  }

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

    // Observability hook for the runtime defense-in-depth fallback in
    // getChampionLoadingImageBase64: log + meter when a participant's
    // requested skin JPG is missing on disk and we silently render with
    // skin 0 instead. Logged at warn (not Sentry) because it's an expected
    // condition during the small window between Riot shipping a new skin
    // and the next `update-data-dragon` run.
    const onSkinFallback = (event: SkinFallbackEvent): void => {
      prematchLoadingScreenSkinFallbackTotal.inc({
        champion: event.championName,
        requested_skin: event.requestedSkin.toString(),
      });
      logger.warn(
        `[sendPrematchNotification] 🎨 Skin fallback for ${event.championName} skin ${event.requestedSkin.toString()} (game ${gameId}) — using base skin art instead. Run update-data-dragon to refresh.`,
      );
    };

    const [image, svg] = await Promise.all([
      loadingScreenToImage(loadingScreenData, { onSkinFallback }),
      loadingScreenToSvg(loadingScreenData, { onSkinFallback }),
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
    void (async () => {
      try {
        await Promise.all([
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
