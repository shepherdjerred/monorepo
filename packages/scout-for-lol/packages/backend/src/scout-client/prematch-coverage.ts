import { classifyGame, type QueueType } from "@scout-for-lol/data";
import { z } from "zod";
import { prisma, type Db } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutClientGamesWithoutPrematch,
  scoutClientObservedGames,
} from "#src/metrics/scout-client.ts";
import { registerDatabaseMetricSweep } from "#src/metrics/sweep-registry.ts";
import { rawArchiveReceiptKind } from "#src/report-lake/durable-receipts.ts";

const logger = createLogger("scout-client-prematch-coverage");

/** The one `game_kind` series both gauges publish (as -1) when the sweep fails. */
const SWEEP_FAILED = "sweep_failed";

/** How far back a client-observed game counts. */
export const PREMATCH_COVERAGE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * How long after the client saw it start a game must be before it counts, so
 * a game Scout is still discovering through Spectator isn't counted as missed.
 */
export const PREMATCH_COVERAGE_GRACE_MS = 15 * 60 * 1000;

const GameRowSchema = z.object({
  gameData: z
    .object({
      gameMode: z.string().optional(),
      gameType: z.string().optional(),
      isCustomGame: z.boolean().optional(),
      queue: z
        .object({
          id: z.number().int().nonnegative(),
          gameMode: z.string().optional(),
          gameType: z.string().optional(),
        })
        .optional(),
    })
    .nullable(),
  missing: z.boolean(),
});

export type PrematchCoverage = {
  readonly observed: number;
  readonly missing: number;
};

/** A queue type, or `unknown` when the classifier cannot name the game. */
export type GameKind = QueueType | "unknown";

function gameKindOf(
  gameData: z.infer<typeof GameRowSchema>["gameData"],
): GameKind {
  const queue = gameData?.queue;
  if (gameData === null || queue === undefined) return "unknown";
  const classification = classifyGame({
    queueId: queue.id,
    gameMode: gameData.gameMode ?? queue.gameMode ?? "",
    gameType:
      gameData.isCustomGame === true
        ? "CUSTOM_GAME"
        : (gameData.gameType ?? queue.gameType),
  });
  return classification.kind === "queue" ? classification.queue : "unknown";
}

/**
 * Games a Scout Client saw in progress in `[observedSince, observedBefore]`,
 * per game kind, and how many have no archived prematch.
 *
 * A game is one platform-qualified id, however many sessions or devices
 * reported it; its prematch is the `raw-archive-prematch` receipt Scout
 * records when Spectator supplied one. The kind is the shared classifier's
 * answer from the client's latest session for the game.
 */
export async function readPrematchCoverage(
  db: Db,
  window: { readonly observedSince: Date; readonly observedBefore: Date },
): Promise<ReadonlyMap<GameKind, PrematchCoverage>> {
  const rows = z.array(GameRowSchema).parse(
    await db.$queryRaw`
      WITH games AS (
        SELECT
          upper("platformId") || '_' || "gameId" AS riot_match_id,
          (array_agg(payload->'data'->'gameData' ORDER BY "receivedAt" DESC))[1]
            AS "gameData"
        FROM "ScoutClientObservation"
        WHERE kind = 'gameflow'
          AND disposition = 'ACCEPTED'
          AND payload->>'resource' = 'gameflow_session'
          AND payload->'data'->>'phase' = 'InProgress'
          AND "gameId" IS NOT NULL
          AND "platformId" IS NOT NULL
          AND "receivedAt" >= ${window.observedSince}
          AND "receivedAt" <= ${window.observedBefore}
        GROUP BY 1
      )
      SELECT
        games."gameData" AS "gameData",
        NOT EXISTS (
          SELECT 1 FROM "MatchProcessingReceipt" receipt
          WHERE receipt."riotMatchId" = games.riot_match_id
            AND receipt.kind = ${rawArchiveReceiptKind("prematch")}
        ) AS missing
      FROM games
    `,
  );
  const coverage = new Map<GameKind, PrematchCoverage>();
  for (const row of rows) {
    const kind = gameKindOf(row.gameData);
    const current = coverage.get(kind) ?? { observed: 0, missing: 0 };
    coverage.set(kind, {
      observed: current.observed + 1,
      missing: current.missing + (row.missing ? 1 : 0),
    });
  }
  return coverage;
}

/**
 * Publish the coverage of the last day's client-observed games.
 *
 * Lives beside the Scout Client rather than in `metrics/` because the
 * prematch receipt kind is `report-lake/`'s vocabulary, which `metrics/` may
 * not import; see `metrics/sweep-registry.ts`.
 */
export async function collectPrematchCoverageMetrics(db: Db): Promise<void> {
  const now = Date.now();
  try {
    const coverage = await readPrematchCoverage(db, {
      observedSince: new Date(now - PREMATCH_COVERAGE_LOOKBACK_MS),
      observedBefore: new Date(now - PREMATCH_COVERAGE_GRACE_MS),
    });
    scoutClientObservedGames.reset();
    scoutClientGamesWithoutPrematch.reset();
    for (const [gameKind, counts] of coverage) {
      scoutClientObservedGames.set({ game_kind: gameKind }, counts.observed);
      scoutClientGamesWithoutPrematch.set(
        { game_kind: gameKind },
        counts.missing,
      );
    }
  } catch (error) {
    scoutClientObservedGames.reset();
    scoutClientGamesWithoutPrematch.reset();
    scoutClientObservedGames.set({ game_kind: SWEEP_FAILED }, -1);
    scoutClientGamesWithoutPrematch.set({ game_kind: SWEEP_FAILED }, -1);
    logger.error("Failed to update the client prematch coverage metrics", {
      error,
    });
  }
}

/** Add this sweep to the scrape-time set; called by the composition root. */
export function registerPrematchCoverageSweep(): void {
  registerDatabaseMetricSweep("scout-client-prematch-coverage", async () => {
    await collectPrematchCoverageMetrics(prisma);
  });
}
