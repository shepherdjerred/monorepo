import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type {
  DiscordGuildId,
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { clashSurfaceEnabledForGuild } from "#src/league/clash/access.ts";
import { attachClashChrome } from "#src/league/clash/chrome.ts";
import {
  buildLoadingScreenData,
  type ParticipantRanks,
} from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { recordLoadingScreenFailure } from "#src/league/tasks/prematch/loading-screen-failure.ts";
import { formatPrematchMessage } from "#src/league/tasks/prematch/prematch-copy.ts";
import {
  loadingScreenToImage,
  loadingScreenToSvg,
} from "@scout-for-lol/report";
import { savePrematchImageToS3, savePrematchSvgToS3 } from "#src/storage/s3.ts";
import {
  prematchLoadingScreenDurationSeconds,
  prematchLoadingScreenGeneratedTotal,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("prematch-notification");

export type PrematchPresentation = {
  clashSurfaceEnabled: boolean;
  loadingScreenData: LoadingScreenData | undefined;
  loadingScreenAttachment: AttachmentBuilder | undefined;
  loadingScreenEmbed: EmbedBuilder | undefined;
  prematchMessageContent: string;
};

export async function clashSurfaceByGuild(
  guildIds: readonly DiscordGuildId[],
): Promise<ReadonlyMap<DiscordGuildId, boolean>> {
  const entries = await Promise.all(
    guildIds.map(
      async (guildId) =>
        [guildId, await clashSurfaceEnabledForGuild(guildId)] as const,
    ),
  );
  return new Map(entries);
}

export function partitionPrematchChannels<T extends { serverId: string }>(
  channels: readonly T[],
  clashByGuild: ReadonlyMap<DiscordGuildId, boolean>,
): { clash: T[]; standard: T[] } {
  const clash: T[] = [];
  const standard: T[] = [];
  for (const channel of channels) {
    const guildId = DiscordGuildIdSchema.parse(channel.serverId);
    if (clashByGuild.get(guildId) === true) {
      clash.push(channel);
    } else {
      standard.push(channel);
    }
  }
  return { clash, standard };
}

export async function renderPrematchPresentation(input: {
  clashSurfaceEnabled: boolean;
  persistAssets: boolean;
  gameId: string;
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: PlayerConfigEntry[];
  aliases: string[];
  region: PlayerConfigEntry["league"]["leagueAccount"]["region"];
  ranksByPuuid: ParticipantRanks;
  queueType: QueueType | undefined;
}): Promise<PrematchPresentation> {
  const loadingScreenStartTime = Date.now();
  let loadingScreenData: LoadingScreenData | undefined;
  try {
    const trackedPuuidSet = new Set(
      input.trackedPlayers.map((p) => p.league.leagueAccount.puuid),
    );
    loadingScreenData = await attachClashChrome(
      await buildLoadingScreenData(
        input.gameInfo,
        trackedPuuidSet,
        input.region,
        input.ranksByPuuid,
      ),
      input.clashSurfaceEnabled,
    );
  } catch (error) {
    recordLoadingScreenFailure({
      error,
      gameId: input.gameId,
      gameInfo: input.gameInfo,
      loadingScreenData,
      queueType: input.queueType,
    });
  }

  const prematchMessageContent = formatPrematchMessage(
    input.trackedPlayers,
    input.queueType,
    input.gameInfo.gameMode,
    input.clashSurfaceEnabled,
  );

  let loadingScreenAttachment: AttachmentBuilder | undefined;
  let loadingScreenEmbed: EmbedBuilder | undefined;
  if (loadingScreenData !== undefined) {
    try {
      const [image, svg] = await Promise.all([
        loadingScreenToImage(loadingScreenData),
        loadingScreenToSvg(loadingScreenData),
      ]);
      const attachmentName = `loading-screen-${input.gameId}.png`;
      loadingScreenAttachment = new AttachmentBuilder(
        Buffer.from(image),
      ).setName(attachmentName);
      loadingScreenEmbed = new EmbedBuilder({
        image: { url: `attachment://${attachmentName}` },
      });

      const duration = (Date.now() - loadingScreenStartTime) / 1000;
      prematchLoadingScreenDurationSeconds.observe(duration);
      prematchLoadingScreenGeneratedTotal.inc({
        queue_type: input.queueType ?? "unknown",
        status: "success",
      });
      logger.info(
        `[sendPrematchNotification] 🖼️ Loading screen generated in ${duration.toFixed(1)}s for game ${input.gameId}`,
      );

      if (input.persistAssets) {
        void persistPrematchAssets({
          aliases: input.aliases,
          gameInfo: input.gameInfo,
          image,
          queueType: input.queueType,
          svg,
        });
      }
    } catch (error) {
      recordLoadingScreenFailure({
        error,
        gameId: input.gameId,
        gameInfo: input.gameInfo,
        loadingScreenData,
        queueType: input.queueType,
      });
    }
  }

  return {
    clashSurfaceEnabled: input.clashSurfaceEnabled,
    loadingScreenData,
    loadingScreenAttachment,
    loadingScreenEmbed,
    prematchMessageContent,
  };
}

async function persistPrematchAssets(input: {
  aliases: string[];
  gameInfo: RawCurrentGameInfo;
  image: Uint8Array;
  queueType: QueueType | undefined;
  svg: string;
}): Promise<void> {
  try {
    await Promise.all([
      savePrematchImageToS3(
        input.gameInfo,
        input.image,
        input.queueType ?? "unknown",
        input.aliases,
      ),
      savePrematchSvgToS3(
        input.gameInfo,
        input.svg,
        input.queueType ?? "unknown",
        input.aliases,
      ),
    ]);
  } catch (s3Error) {
    logger.error(
      `[sendPrematchNotification] Failed to save prematch assets to S3:`,
      s3Error,
    );
  }
}
