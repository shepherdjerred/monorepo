import { logger } from "#src/logger.ts";

/**
 * Commit live game progress to the flash save at the end of a goal so a restart
 * resumes where the agent left off instead of the last in-game save. Call while
 * the goal still holds the input lease, so no queued Discord/web command can
 * move the game before the save. Emerald only saves in the overworld or a
 * battle; anywhere else the engine checkpoint rejects and we log and continue
 * rather than fail goal teardown.
 */
export async function saveOnGoalEnd(
  checkpointGame: () => Promise<void>,
  status: string,
): Promise<void> {
  try {
    await checkpointGame();
  } catch (error) {
    logger.warn(
      `goal-manager: checkpoint save skipped at goal end (${status})`,
      error,
    );
  }
}
