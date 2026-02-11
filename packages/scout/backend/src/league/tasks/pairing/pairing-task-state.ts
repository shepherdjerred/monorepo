import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("pairing-task-state");

/**
 * Module-level state to track running pairing updates.
 * This prevents concurrent runs and allows cancellation of stuck tasks.
 */
let inProgress = false;
let abortController: AbortController | null = null;
let startedAt: Date | null = null;

/**
 * Check if a pairing update is currently running
 */
export function isRunning(): boolean {
  return inProgress;
}

/**
 * Get information about the current running task
 */
export function getTaskInfo(): { running: boolean; startedAt: Date | null } {
  return {
    running: inProgress,
    startedAt,
  };
}

/**
 * Start a new pairing update task.
 * Throws an error if a task is already running.
 * Returns an AbortSignal that can be used to check for cancellation.
 */
export function startTask(): AbortSignal {
  if (inProgress) {
    const runningFor = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0;
    throw new Error(`Pairing update is already running (started ${runningFor.toString()}s ago)`);
  }

  inProgress = true;
  abortController = new AbortController();
  startedAt = new Date();

  logger.info(`[TaskState] 🚀 Pairing update task started at ${startedAt.toISOString()}`);

  return abortController.signal;
}

/**
 * Cancel the currently running pairing update task.
 * Does nothing if no task is running.
 */
export function cancelTask(): void {
  if (!inProgress || !abortController) {
    logger.warn("[TaskState] No task to cancel");
    return;
  }

  logger.info("[TaskState] 🛑 Cancelling pairing update task");
  abortController.abort();
}

/**
 * Mark the current task as finished.
 * Should be called in a finally block to ensure cleanup.
 */
export function finishTask(): void {
  if (!inProgress) {
    logger.warn("[TaskState] No task to finish");
    return;
  }

  const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0;
  logger.info(`[TaskState] ✅ Pairing update task finished after ${elapsed.toString()}s`);

  inProgress = false;
  abortController = null;
  startedAt = null;
}

/**
 * Check if the current task has been cancelled
 */
export function isCancelled(): boolean {
  return abortController?.signal.aborted ?? false;
}
