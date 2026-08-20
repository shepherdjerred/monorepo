import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type {
  RawCurrentGameInfo,
  PlayerConfigEntry,
  LeaguePuuid,
  DiscordGuildId,
  QueueType,
} from "@scout-for-lol/data/index.ts";
import {
  resolveQueueTypeFromGame,
  queueTypeToDisplayString,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/index.ts";
import { send, ChannelSendError } from "#src/league/discord/channel.ts";
import { getChampionDisplayName } from "#src/utils/champion.ts";
import { createLogger } from "#src/logger.ts";
import { uniqueBy } from "remeda";
import * as Sentry from "@sentry/bun";
import {
  RecoverableLoadingScreenDataError,
  UnsupportedLoadingScreenQueueError,
  buildLoadingScreenData,
} from "#src/league/tasks/prematch/loading-screen-builder.ts";
import {
  loadingScreenToImage,
  loadingScreenToSvg,
} from "@scout-for-lol/report";
import { savePrematchImageToS3, savePrematchSvgToS3 } from "#src/storage/s3.ts";
import {
  classicAssetResolutionFailuresTotal,
  prematchLoadingScreenGeneratedTotal,
  prematchLoadingScreenDurationSeconds,
} from "#src/metrics/index.ts";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { recordPoolMessageRefs } from "#src/betting/pool-open.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { appendBucksLine } from "#src/betting/prematch-line.ts";
import {
  prepareBucksPrematch,
  type BucksPrematchAttachment,
} from "#src/betting/prematch-hook.ts";
import { startParlayGeneration } from "#src/betting/parlay-generate.ts";
import type { MessageCreateOptions } from "discord.js";
import type { LoadingScreenData } from "@scout-for-lol/data/index.ts";

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
  const article = queueName === "arena" ? "an" : "a";
  const aliases = trackedPlayers
    .map((p) => p.alias)
    .filter((alias) => alias.trim().length > 0);
  if (aliases.length === 0) {
    return `Game started: ${queueName}`;
  }
  return `${formatPlayerList(aliases)} started ${article} ${queueName} game`;
}

/**
 * Rich text embed used as a fallback when the loading-screen image cannot
 * be generated. Preserves the prior text-only notification experience.
 */
function buildFallbackPrematchEmbed(
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
 * Send pre-match notifications to all subscribed Discord channels.
 */

/**
 * The message payload for one channel.
 *
 * Extracted from `sendPrematchNotification` to keep that function's branching
 * within the complexity budget, and because "what does this message look like"
 * is a separate question from "where does it go".
 */
function buildPrematchPayload(input: {
  betsOpen: boolean;
  bucks: BucksPrematchAttachment;
  baseContent: string;
  loadingScreenAttachment: AttachmentBuilder | undefined;
  loadingScreenEmbed: EmbedBuilder | undefined;
  fallbackEmbed: () => EmbedBuilder;
}): MessageCreateOptions {
  const components =
    input.betsOpen && input.bucks.rows.length > 0 ? input.bucks.rows : [];

  if (input.loadingScreenAttachment && input.loadingScreenEmbed) {
    return {
      content: input.betsOpen
        ? appendBucksLine(input.baseContent, input.bucks.footer)
        : input.baseContent,
      files: [input.loadingScreenAttachment],
      embeds: [input.loadingScreenEmbed],
      components,
    };
  }

  // The fallback path still carries buttons: a market's validity depends on the
  // game, not on whether the image rendered. The prediction is absent here
  // because no ranks were fetched, so there is no extra message content.
  return {
    ...(input.betsOpen && input.bucks.footer.length > 0
      ? { content: input.bucks.footer }
      : {}),
    embeds: [input.fallbackEmbed()],
    components,
  };
}

/**
 * Persist the outputs that depend on successful Discord delivery, then start
 * the best-effort parlay generation after those records are durable.
 */
async function recordPrematchOutputs(input: {
  bucks: BucksPrematchAttachment;
  deliveredGuildIds: Set<DiscordGuildId>;
  gameInfo: RawCurrentGameInfo;
  loadingScreenData: LoadingScreenData | undefined;
  messageRefsByGuild: Map<string, { channelId: string; messageId: string }[]>;
  prematchContentBase: string;
  queueType: QueueType | undefined;
  trackedPlayers: PlayerConfigEntry[];
}): Promise<void> {
  for (const [serverId, refs] of input.messageRefsByGuild) {
    await recordPoolMessageRefs({
      matchId: input.bucks.matchId,
      serverId: DiscordGuildIdSchema.parse(serverId),
      refs,
      prematchContentBase: input.prematchContentBase,
    });
    await refreshBucksMessages({
      matchId: input.bucks.matchId,
      serverId: DiscordGuildIdSchema.parse(serverId),
    });
  }

  await recordCoreOutputsDelivered(input.deliveredGuildIds, "prematch");

  // The parlay is deliberately generated only after the ordinary prematch
  // message and outcome-pool references are durable. This starts a caught
  // background task, so the 30-second spectator polling lock is not held for
  // the model's up-to-60-second deadline.
  if (input.bucks.bettingGuildIds.size > 0) {
    startParlayGeneration({
      gameInfo: input.gameInfo,
      trackedPlayers: input.trackedPlayers,
      queueType: input.queueType,
      loadingScreenData: input.loadingScreenData,
    });
  }
}

type PrematchDeliveryChannel = Awaited<
  ReturnType<typeof getChannelsSubscribedToPlayers>
>[number];

async function deliverPrematchMessages(input: {
  channels: PrematchDeliveryChannel[];
  gameInfo: RawCurrentGameInfo;
  gameId: string;
  trackedPlayers: PlayerConfigEntry[];
  bucks: BucksPrematchAttachment;
  prematchMessageContent: string;
  loadingScreenAttachment: AttachmentBuilder | undefined;
  loadingScreenEmbed: EmbedBuilder | undefined;
}): Promise<{
  sentMessageIds: Map<string, string>;
  deliveredGuildIds: Set<DiscordGuildId>;
  messageRefsByGuild: Map<string, { channelId: string; messageId: string }[]>;
}> {
  const sentMessageIds = new Map<string, string>();
  const deliveredGuildIds = new Set<DiscordGuildId>();
  const messageRefsByGuild = new Map<
    string,
    { channelId: string; messageId: string }[]
  >();

  for (const { channel, serverId } of input.channels) {
    try {
      const guildId = DiscordGuildIdSchema.parse(serverId);
      const betsOpen = input.bucks.bettingGuildIds.has(guildId);
      const message = buildPrematchPayload({
        betsOpen,
        bucks: input.bucks,
        baseContent: input.prematchMessageContent,
        loadingScreenAttachment: input.loadingScreenAttachment,
        loadingScreenEmbed: input.loadingScreenEmbed,
        fallbackEmbed: () =>
          buildFallbackPrematchEmbed(input.gameInfo, input.trackedPlayers),
      });
      const sentMessage = await send(message, channel, guildId);
      sentMessageIds.set(channel, sentMessage.id);
      deliveredGuildIds.add(guildId);
      if (betsOpen) {
        messageRefsByGuild.set(guildId, [
          ...(messageRefsByGuild.get(guildId) ?? []),
          { channelId: channel, messageId: sentMessage.id },
        ]);
      }
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
        tags: {
          source: "prematch-notification",
          gameId: input.gameId,
          channel,
        },
      });
    }
  }

  return { sentMessageIds, deliveredGuildIds, messageRefsByGuild };
}

export async function sendPrematchNotification(
  gameInfo: RawCurrentGameInfo,
  trackedPlayers: PlayerConfigEntry[],
): Promise<Map<string, string>> {
  const gameId = gameInfo.gameId.toString();
  const aliases = trackedPlayers.map((p) => p.alias);
  logger.info(
    `[sendPrematchNotification] 📢 Sending notification for game ${gameId} with ${trackedPlayers.length.toString()} tracked player(s)`,
  );

  // The authoritative raw spectator payload is written to S3 upstream by the
  // detection ingest (recordPrematchForReportStore in active-game-detection.ts)
  // before this runs, so there is no spectator-data S3 write here.

  const puuids: LeaguePuuid[] = trackedPlayers.map(
    (p) => p.league.leagueAccount.puuid,
  );
  const channels = await getChannelsSubscribedToPlayers(puuids);

  if (channels.length === 0) {
    logger.info(
      `[sendPrematchNotification] ⚠️  No channels subscribed for game ${gameId}`,
    );
    return new Map();
  }

  // Apply per-subscription notification filters (queue type, etc.).
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  const deliverChannels = channelsPassingQueueFilter(channels, queueType);
  if (deliverChannels.length === 0) {
    logger.info(
      `[sendPrematchNotification] 🔕 Game ${gameId} filtered out for all channels (queue ${queueType ?? "unknown"})`,
    );
    return new Map();
  }

  const targetGuildIds: DiscordGuildId[] = uniqueBy(
    deliverChannels.map((c) => DiscordGuildIdSchema.parse(c.serverId)),
    (id) => id,
  );

  logger.info(
    `[sendPrematchNotification] 📺 Sending to ${deliverChannels.length.toString()} channel(s) across ${targetGuildIds.length.toString()} guild(s)`,
  );

  const prematchMessageContent = formatPrematchMessage(
    trackedPlayers,
    queueType,
    gameInfo.gameMode,
  );

  // Generate loading screen image. Preferred delivery: image + short text.
  // If generation fails, we fall back to a rich text embed (buildFallbackPrematchEmbed).
  let loadingScreenAttachment: AttachmentBuilder | undefined;
  let loadingScreenEmbed: EmbedBuilder | undefined;
  // Hoisted so the Bryan Bucks prediction can reuse the ranks this already
  // fetched for all ten players. Re-fetching them would be thousands of Riot
  // calls a minute across the polling loop.
  let loadingScreenData: LoadingScreenData | undefined;
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

    loadingScreenData = await buildLoadingScreenData(
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
    recordClassicLoadingScreenFailure(loadingScreenData, error);
    const isRecoverable = error instanceof RecoverableLoadingScreenDataError;
    prematchLoadingScreenGeneratedTotal.inc({
      queue_type: queueType ?? "unknown",
      status: isRecoverable ? "fallback" : "error",
    });
    logger.error(
      `[sendPrematchNotification] ❌ Failed to generate loading screen for game ${gameId}:`,
      error,
    );
    if (!isRecoverable) {
      const context =
        error instanceof UnsupportedLoadingScreenQueueError
          ? {
              fingerprint: [
                "prematch-unsupported-queue",
                gameInfo.gameQueueConfigId.toString(),
                gameInfo.gameMode,
                gameInfo.mapId.toString(),
              ],
              tags: {
                source: "prematch-loading-screen",
                gameId,
                gameQueueConfigId: gameInfo.gameQueueConfigId.toString(),
                mapId: gameInfo.mapId.toString(),
                gameMode: gameInfo.gameMode,
              },
            }
          : {
              tags: {
                source: "prematch-loading-screen",
                gameId,
                gameQueueConfigId: gameInfo.gameQueueConfigId.toString(),
                mapId: gameInfo.mapId.toString(),
                gameMode: gameInfo.gameMode,
              },
            };
      Sentry.captureException(error, context);
    }
    // Continue with text-only notification
  }

  // Bryan Bucks: open the markets and build the buttons. Entirely
  // best-effort — on any failure this yields no guilds, no rows, and the
  // notification below is exactly what it was before the feature existed.
  const bucks = await prepareBucksPrematch({
    gameInfo,
    trackedPlayers,
    queueType,
    targetGuildIds,
    loadingScreenData,
    detectedAt: new Date(),
  });
  const prematchContentBase =
    loadingScreenAttachment !== undefined && loadingScreenEmbed !== undefined
      ? prematchMessageContent
      : "";

  const delivery = await deliverPrematchMessages({
    channels: deliverChannels,
    gameInfo,
    gameId,
    trackedPlayers,
    bucks,
    prematchMessageContent,
    loadingScreenAttachment,
    loadingScreenEmbed,
  });

  await recordPrematchOutputs({
    bucks,
    deliveredGuildIds: delivery.deliveredGuildIds,
    gameInfo,
    loadingScreenData,
    messageRefsByGuild: delivery.messageRefsByGuild,
    prematchContentBase,
    queueType,
    trackedPlayers,
  });

  logger.info(
    `[sendPrematchNotification] ✅ Notifications sent for game ${gameId}`,
  );
  return delivery.sentMessageIds;
}

function recordClassicLoadingScreenFailure(
  loadingScreenData: LoadingScreenData | undefined,
  error: unknown,
): void {
  if (loadingScreenData?.layout !== "classic") return;
  classicAssetResolutionFailuresTotal.inc({
    phase: "prematch",
    reason: "asset",
  });
  logger.error(
    "Classic prematch loading-screen asset rendering failed",
    error,
    {
      championIds: loadingScreenData.participants.map(
        (participant) => participant.championId,
      ),
    },
  );
}
