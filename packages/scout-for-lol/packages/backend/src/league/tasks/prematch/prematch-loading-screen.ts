import type {
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import * as Sentry from "@sentry/bun";
import {
  UnsupportedLoadingScreenQueueError,
  buildLoadingScreenData,
} from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { RecoverableLoadingScreenDataError } from "#src/league/tasks/prematch/loading-screen-errors.ts";
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
import { createLogger } from "#src/logger.ts";

const logger = createLogger("prematch-notification");

/**
 * Render the loading-screen image, or fall back to text.
 *
 * The image path carries its own metrics, Sentry fingerprinting, and
 * fire-and-forget S3 writes. Keeping it separate leaves notification delivery
 * responsible only for sending and recording messages.
 */
export async function renderPrematchLoadingScreen(input: {
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: PlayerConfigEntry[];
  queueType: QueueType | undefined;
  gameId: string;
  aliases: string[];
}): Promise<{
  attachment: AttachmentBuilder | undefined;
  embed: EmbedBuilder | undefined;
  data: LoadingScreenData | undefined;
}> {
  const { gameInfo, trackedPlayers, queueType, gameId, aliases } = input;
  let loadingScreenAttachment: AttachmentBuilder | undefined;
  let loadingScreenEmbed: EmbedBuilder | undefined;
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
  }

  return {
    attachment: loadingScreenAttachment,
    embed: loadingScreenEmbed,
    data: loadingScreenData,
  };
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
