import { checkActiveGames } from "#src/league/tasks/prematch/active-game-detection.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("tasks-prematch");

export async function checkPreMatch() {
  logger.info("🎯 Starting pre-match check task");
  const startTime = Date.now();

  try {
    await checkActiveGames();

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
