import { runWeeklyPairingUpdate as runWeeklyPairingUpdateInternal } from "./weekly-update.ts";
import {
  isRunning as isRunningInternal,
  cancelTask as cancelTaskInternal,
  getTaskInfo as getTaskInfoInternal,
} from "./pairing-task-state.ts";

/**
 * Run the weekly Common Denominator pairing update
 * Posts pairing winrates and surrender stats to Discord
 * Returns { success: boolean, message: string } indicating whether the task ran
 */
export async function runWeeklyPairingUpdate(): Promise<{ success: boolean; message: string }> {
  return runWeeklyPairingUpdateInternal();
}

/**
 * Check if a pairing update is currently running
 */
export function isPairingUpdateRunning(): boolean {
  return isRunningInternal();
}

/**
 * Cancel the currently running pairing update
 */
export function cancelPairingUpdate(): void {
  cancelTaskInternal();
}

/**
 * Get info about the current pairing update task
 */
export function getPairingUpdateInfo(): { running: boolean; startedAt: Date | null } {
  return getTaskInfoInternal();
}
