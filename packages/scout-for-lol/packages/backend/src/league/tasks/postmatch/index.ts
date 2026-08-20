import { retryPendingBucksEarnings } from "#src/betting/earnings-retry.ts";
import { checkMatchHistory } from "#src/league/tasks/postmatch/match-history-polling.ts";
import { voidStaleBettingPools } from "#src/betting/sweep.ts";
import { voidStaleParlayMarkets } from "#src/betting/parlay-sweep.ts";
import { createLogger } from "#src/logger.ts";

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

  try {
    let matchHistoryError: unknown;
    try {
      await checkMatchHistory();
    } catch (error) {
      matchHistoryError = error;
      logger.error(
        "❌ Match history polling failed; running Bryan Bucks recovery anyway:",
        error,
      );
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
    await voidStaleBettingPools();
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
