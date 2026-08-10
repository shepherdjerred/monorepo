// Small helpers shared by GoalManager. Lives here so goal-manager.ts can
// stay focused on lifecycle + concurrency without tripping the per-file
// line cap.

import type { GoalProcess } from "./goal-types.ts";

// Settle a goal's child process: optionally SIGTERM it, await its exit and
// stdout pump, then run `onSettled` (drains in-flight control-server commands).
// Deliberately does NOT release the input lease — the caller keeps it held
// through its terminal checkpoint save and releases it afterwards, so no
// Discord/web command can move the game between goal end and the save.
export async function settleGoalProcess(
  resources: {
    process: GoalProcess;
    stdoutPump: Promise<void>;
  },
  terminate: boolean,
  onSettled: () => Promise<void> = () => Promise.resolve(),
): Promise<number> {
  if (terminate) resources.process.kill("SIGTERM");
  try {
    const exitCode = await resources.process.exited;
    await resources.stdoutPump;
    return exitCode;
  } finally {
    await onSettled();
  }
}
