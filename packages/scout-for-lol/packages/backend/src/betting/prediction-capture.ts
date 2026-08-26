import * as Sentry from "@sentry/bun";
import type {
  BucksPrediction,
  BucksPredictionObservation,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { isBettableGame } from "#src/betting/eligibility.ts";
import { computeGameStartAt } from "#src/betting/pool-open.ts";
import { buildPredictionObservation } from "#src/betting/prediction-inputs.ts";
import { createLogger } from "#src/logger.ts";
import type { ParticipantRanks } from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { ingestPredictionObservation } from "#src/report-store/store.ts";
import {
  enqueuePredictionObservation,
  shouldUseTemporalBackgroundWork,
} from "#src/temporal/work-store.ts";

const logger = createLogger("betting-prediction-capture");

export type PredictionCaptureDependencies = {
  build: typeof buildPredictionObservation;
  ingest: (observation: BucksPredictionObservation) => Promise<void>;
};

async function enqueuePredictionBestEffort(
  observation: BucksPredictionObservation,
  matchId: string,
): Promise<void> {
  try {
    await enqueuePredictionObservation(observation);
  } catch (error: unknown) {
    logger.error(
      `Failed to enqueue prediction observation for ${matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "prediction-observation-enqueue", matchId },
    });
  }
}

const defaultDependencies: PredictionCaptureDependencies = {
  build: buildPredictionObservation,
  ingest: ingestPredictionObservation,
};

/** Capture one match-level estimate. No guild flag is accepted here: eligible
 * games feed evaluation even when no guild can buy or use Bryan Bucks. */
export async function capturePredictionForPrematch(
  input: {
    gameInfo: RawCurrentGameInfo;
    queueType: QueueType | undefined;
    ranksByPuuid: ParticipantRanks;
    observedAt: Date;
  },
  dependencies: PredictionCaptureDependencies = defaultDependencies,
): Promise<BucksPrediction | undefined> {
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;
  const queueType = input.queueType;
  if (
    queueType === undefined ||
    !isBettableGame({
      queueType,
      participants: input.gameInfo.participants,
    })
  ) {
    return undefined;
  }

  let observation: BucksPredictionObservation | undefined;
  try {
    observation = await dependencies.build({
      gameInfo: input.gameInfo,
      ranksByPuuid: input.ranksByPuuid,
      matchId,
      platformId: input.gameInfo.platformId,
      queueType,
      observedAt: input.observedAt,
      gameStartAt: computeGameStartAt({
        detectedAt: input.observedAt,
        gameStartTime: input.gameInfo.gameStartTime,
        gameLength: input.gameInfo.gameLength,
      }),
    });
  } catch (error) {
    logger.error(
      `Failed to build prediction observation for ${matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "prediction-observation-build", matchId },
    });
    return undefined;
  }
  if (observation === undefined) {
    return undefined;
  }

  if (shouldUseTemporalBackgroundWork()) {
    void enqueuePredictionBestEffort(observation, matchId);
  } else {
    // Legacy ownership remains best-effort until the Temporal family flag is
    // enabled. The immutable observation makes this write idempotent.
    void (async () => {
      try {
        await dependencies.ingest(observation);
      } catch (error) {
        logger.error(
          `Failed to persist prediction observation for ${matchId}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: { source: "prediction-observation-ingest", matchId },
        });
      }
    })();
  }
  return observation.prediction;
}
