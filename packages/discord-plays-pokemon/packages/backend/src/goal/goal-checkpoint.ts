import { logger } from "#src/logger.ts";

// Retry policy for the end-of-goal checkpoint. Emerald only saves in the
// overworld or a battle, so a rejection often just means a transient cutscene
// or animation is playing; a few spaced retries let it clear before we give up.
export type CheckpointRetry = {
  attempts: number;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
};

export const defaultCheckpointRetry: CheckpointRetry = {
  attempts: 3,
  delayMs: 1000,
  sleep: (ms) => Bun.sleep(ms),
};

/**
 * Commit live game progress to the flash save so a restart resumes where the
 * agent left off instead of the last in-game save. Emerald only saves in the
 * overworld or a battle; anywhere else the engine checkpoint rejects, so retry a
 * few times to let a transient cutscene/menu/title state clear. Callers never
 * fail teardown on a checkpoint error, but a persistent failure is surfaced at
 * error level rather than swallowed, because it means the game's in-game
 * progress will revert to the last in-game save on the next restart. `context`
 * identifies the terminal path (e.g. "goal end: timeout", "session stop") in the
 * logs.
 */
export async function checkpointWithRetry(
  checkpointGame: () => Promise<void>,
  context: string,
  retry: CheckpointRetry = defaultCheckpointRetry,
): Promise<void> {
  const attempts = Math.max(1, retry.attempts);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await checkpointGame();
      return;
    } catch (error) {
      if (attempt === attempts) {
        logger.error(
          `checkpoint save failed (${context}) after ${String(
            attempts,
          )} attempt(s); in-game progress will revert to the last in-game save on restart`,
          error,
        );
        return;
      }
      logger.warn(
        `checkpoint save attempt ${String(attempt)} failed (${context}); retrying`,
        error,
      );
      await retry.sleep(retry.delayMs);
    }
  }
}

/** Checkpoint at the end of a goal. Call while the goal still holds the input
 * lease, so no queued Discord/web command can move the game before the save. */
export function saveOnGoalEnd(
  checkpointGame: () => Promise<void>,
  status: string,
  retry: CheckpointRetry = defaultCheckpointRetry,
): Promise<void> {
  return checkpointWithRetry(checkpointGame, `goal end: ${status}`, retry);
}
