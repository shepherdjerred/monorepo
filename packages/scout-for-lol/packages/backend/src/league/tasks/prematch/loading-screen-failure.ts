import * as Sentry from "@sentry/bun";
import type {
  LoadingScreenData,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { UnsupportedLoadingScreenQueueError } from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { RecoverableLoadingScreenDataError } from "#src/league/tasks/prematch/loading-screen-errors.ts";
import { createLogger } from "#src/logger.ts";
import {
  classicAssetResolutionFailuresTotal,
  prematchLoadingScreenGeneratedTotal,
} from "#src/metrics/index.ts";

const logger = createLogger("prematch-notification");

export function recordLoadingScreenFailure(input: {
  error: unknown;
  gameId: string;
  gameInfo: RawCurrentGameInfo;
  loadingScreenData: LoadingScreenData | undefined;
  queueType: QueueType | undefined;
}): void {
  const error = input.error;
  if (input.loadingScreenData?.layout === "classic") {
    classicAssetResolutionFailuresTotal.inc({
      phase: "prematch",
      reason: "asset",
    });
    logger.error(
      "Classic prematch loading-screen asset rendering failed",
      error,
      {
        championIds: input.loadingScreenData.participants.map(
          (participant) => participant.championId,
        ),
      },
    );
  }
  const isRecoverable = error instanceof RecoverableLoadingScreenDataError;
  prematchLoadingScreenGeneratedTotal.inc({
    queue_type: input.queueType ?? "unknown",
    status: isRecoverable ? "fallback" : "error",
  });
  logger.error(
    `[sendPrematchNotification] ❌ Failed to generate loading screen for game ${input.gameId}:`,
    error,
  );
  if (isRecoverable) {
    return;
  }
  const context =
    error instanceof UnsupportedLoadingScreenQueueError
      ? {
          fingerprint: [
            "prematch-unsupported-queue",
            input.gameInfo.gameQueueConfigId.toString(),
            input.gameInfo.gameMode,
            input.gameInfo.mapId.toString(),
          ],
          tags: {
            source: "prematch-loading-screen",
            gameId: input.gameId,
            gameQueueConfigId: input.gameInfo.gameQueueConfigId.toString(),
            mapId: input.gameInfo.mapId.toString(),
            gameMode: input.gameInfo.gameMode,
          },
        }
      : {
          tags: {
            source: "prematch-loading-screen",
            gameId: input.gameId,
            gameQueueConfigId: input.gameInfo.gameQueueConfigId.toString(),
            mapId: input.gameInfo.mapId.toString(),
            gameMode: input.gameInfo.gameMode,
          },
        };
  Sentry.captureException(error, context);
}
