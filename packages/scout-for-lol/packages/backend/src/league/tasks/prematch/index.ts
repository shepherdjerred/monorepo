import { checkActiveGames } from "#src/league/tasks/prematch/active-game-detection.ts";
import { closeExpiredBettingWindows } from "#src/betting/sweep.ts";
import { disableClosedBettingMessages } from "#src/betting/announce.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("tasks-prematch");

export async function checkPreMatch() {
  logger.info("🎯 Starting pre-match check task");
  const startTime = Date.now();

  try {
    await checkActiveGames();

    // Grey out the buttons on windows that have just expired. Purely cosmetic:
    // a click on a live-looking button is still refused by placeBet, which
    // re-checks closesAt inside its transaction.
    const closed = await closeExpiredBettingWindows();
    await disableClosedBettingMessages(closed);

    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ Pre-match check completed successfully in ${executionTime.toString()}ms`,
    );
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ Pre-match check failed after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}
