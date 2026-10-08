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

/** How far back a client-observed game counts. */
export const PREMATCH_COVERAGE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * How long after the client saw it start a game must be before it counts, so
 * a game Scout is still discovering through Spectator isn't counted as missed.
 */
export const PREMATCH_COVERAGE_GRACE_MS = 15 * 60 * 1000;

const CoverageRowSchema = z.object({
  custom: z.boolean(),
  observed: z.coerce.number().int().nonnegative(),
  missing: z.coerce.number().int().nonnegative(),
});

export type PrematchCoverage = {
  readonly observed: number;
  readonly missing: number;
};

/**
 * Games a Scout Client saw in progress in `[observedSince, observedBefore]`,
 * per custom/matchmade, and how many have no archived prematch.
 *
 * A game is one platform-qualified id, however many sessions or devices
 * reported it; its prematch is the `raw-archive-prematch` receipt Scout
 * records when Spectator supplied one.
 */
export async function readPrematchCoverage(
  db: Db,
  window: { readonly observedSince: Date; readonly observedBefore: Date },
): Promise<{ custom: PrematchCoverage; matchmade: PrematchCoverage }> {
  const rows = z.array(CoverageRowSchema).parse(
    await db.$queryRaw`
      WITH games AS (
        SELECT
          upper("platformId") || '_' || "gameId" AS riot_match_id,
          bool_or(
            coalesce((payload->'data'->'gameData'->>'isCustomGame')::boolean, false)
          ) AS custom
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
        games.custom AS custom,
        count(*) AS observed,
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM "MatchProcessingReceipt" receipt
          WHERE receipt."riotMatchId" = games.riot_match_id
            AND receipt.kind = ${rawArchiveReceiptKind("prematch")}
        )) AS missing
      FROM games
      GROUP BY games.custom
    `,
  );
  const coverageOf = (custom: boolean): PrematchCoverage => {
    const row = rows.find((candidate) => candidate.custom === custom);
    return { observed: row?.observed ?? 0, missing: row?.missing ?? 0 };
  };
  return { custom: coverageOf(true), matchmade: coverageOf(false) };
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
    for (const [custom, counts] of [
      ["true", coverage.custom],
      ["false", coverage.matchmade],
    ] as const) {
      scoutClientObservedGames.set({ custom }, counts.observed);
      scoutClientGamesWithoutPrematch.set({ custom }, counts.missing);
    }
  } catch (error) {
    for (const custom of ["true", "false"]) {
      scoutClientObservedGames.set({ custom }, -1);
      scoutClientGamesWithoutPrematch.set({ custom }, -1);
    }
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
