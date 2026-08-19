import { checkMatchHistory } from "#src/league/tasks/postmatch/match-history-polling.ts";
import { voidStaleBettingPools } from "#src/betting/sweep.ts";
import { voidStaleParlayMarkets } from "#src/betting/parlay-sweep.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("tasks-postmatch");

export async function checkPostMatch() {
  logger.info("🏁 Starting post-match check task");
  const startTime = Date.now();

  try {
    await checkMatchHistory();

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
