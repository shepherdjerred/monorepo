import { retryPendingBucksEarnings } from "#src/betting/earnings-retry.ts";
import {
  checkMatchHistory,
  isMatchHistoryPollingInProgress,
} from "#src/league/tasks/postmatch/match-history-polling.ts";
import { announceSettlements } from "#src/betting/announce.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";
import { voidStaleBettingPools } from "#src/betting/void-stale.ts";
import { voidStaleParlayMarkets } from "#src/betting/parlay-sweep.ts";
import { getPostmatchMessageIdsForMatchIdOrEmpty } from "#src/league/tasks/prematch/active-game-queries.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { runInitialHistoryImportTick } from "#src/league/initial-history/worker.ts";

const logger = createLogger("tasks-postmatch");

function asError(error: unknown, message: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(message, { cause: error });
}

export async function checkPostMatch() {
  logger.info("🏁 Starting post-match check task");
  const startTime = Date.now();
  const bettingHardDisabled = isFeatureHardDisabled("betting_enabled");

  try {
    let matchHistoryError: unknown;
    try {
      await checkMatchHistory();
    } catch (error) {
      matchHistoryError = error;
      logger.error(
        bettingHardDisabled
          ? "❌ Match history polling failed:"
          : "❌ Match history polling failed; running Bryan Bucks recovery anyway:",
        error,
      );
    }
    if (matchHistoryError === undefined && !isMatchHistoryPollingInProgress()) {
      try {
        await runInitialHistoryImportTick();
      } catch (error) {
        // The durable job retained its checkpoint. Import traffic must never
        // turn a successful notification-critical poll into a failed cron run.
        logger.error(
          "Initial history import tick failed after live polling",
          error,
        );
      }
    }

    if (bettingHardDisabled) {
      if (matchHistoryError !== undefined) {
        throw asError(matchHistoryError, "Match history polling failed");
      }
      const executionTime = Date.now() - startTime;
      logger.info(
        `✅ Post-match check completed successfully in ${executionTime.toString()}ms`,
      );
      return;
    }

    let earningsRecoveryError: unknown;
    try {
      await retryPendingBucksEarnings();
    } catch (error) {
      earningsRecoveryError = error;
    }

    if (
      matchHistoryError !== undefined &&
      earningsRecoveryError !== undefined
    ) {
      throw new AggregateError(
        [matchHistoryError, earningsRecoveryError],
        "Post-match polling and Bryan Bucks recovery both failed",
      );
    }
    if (matchHistoryError !== undefined) {
      throw asError(matchHistoryError, "Match history polling failed");
    }
    if (earningsRecoveryError !== undefined) {
      throw asError(earningsRecoveryError, "Bryan Bucks recovery failed");
    }

    // Refund any pool whose match never produced a result. Without this,
    // staked Bucks from a lost match would be silently destroyed.
    const staleBucks = await voidStaleBettingPools();
    const staleMatchIds = new Set([
      ...staleBucks.closures.map((closure) => closure.matchId),
      ...staleBucks.settlements.map((settlement) => settlement.matchId),
    ]);
    await refreshClosedBucksMessages([
      ...staleBucks.closures,
      ...staleBucks.settlements,
    ]);
    for (const matchId of staleMatchIds) {
      // Usually empty: the ActiveGame TTL is 3h and VOID_GRACE_MS is 6h, so the
      // row is normally gone by the time a pool is voided. When it survives,
      // the void notice replies to the report instead of floating free.
      const parsedMatchId = MatchIdSchema.safeParse(matchId);
      const postmatchMessageIds = parsedMatchId.success
        ? await getPostmatchMessageIdsForMatchIdOrEmpty(parsedMatchId.data)
        : new Map<string, string>();
      await announceSettlements({
        matchId,
        closures: staleBucks.closures.filter(
          (closure) => closure.matchId === matchId,
        ),
        settlements: staleBucks.settlements.filter(
          (settlement) => settlement.matchId === matchId,
        ),
        // voidStaleParlayMarkets runs after this and rewrites each voided
        // parlay's own market message, so nothing is lost by not carrying one
        // here — and no extra post-match message is created.
        parlaySettlements: [],
        earnings: [],
        postmatchMessageIds,
      });
    }
    await voidStaleParlayMarkets();

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ Post-match check completed successfully in ${executionTime.toString()}ms`,
    );
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ Post-match check failed after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}
