// Small helpers shared by GoalManager. Lives here so goal-manager.ts can
// stay focused on lifecycle + concurrency without tripping the per-file
// line cap.

import type { GoalProcess } from "./goal-types.ts";

/**
 * How long a terminated goal process gets to exit after SIGTERM, and again
 * after SIGKILL. Bounded so session teardown always reaches its save
 * checkpoint inside the pod's termination grace period.
 */
export const GOAL_TERMINATE_TIMEOUT_MS = 15_000;

// Settle a goal's child process: optionally SIGTERM it, await its exit and
// stdout pump, then run `onSettled` (drains in-flight control-server commands).
// Deliberately does NOT release the input lease — the caller keeps it held
// through its terminal checkpoint save and releases it afterwards, so no
// Discord/web command can move the game between goal end and the save.
// A terminated process that ignores SIGTERM is SIGKILLed; one that still does
// not exit fails the settle instead of blocking teardown forever.
export async function settleGoalProcess(
  resources: {
    process: GoalProcess;
    stdoutPump: Promise<void>;
  },
  terminate: boolean,
  onSettled: () => Promise<void> = () => Promise.resolve(),
  terminateTimeoutMs: number = GOAL_TERMINATE_TIMEOUT_MS,
): Promise<number> {
  try {
    if (!terminate) {
      const exitCode = await resources.process.exited;
      await resources.stdoutPump;
      return exitCode;
    }
    resources.process.kill("SIGTERM");
    let exitCode = await exitWithin(resources.process, terminateTimeoutMs);
    if (exitCode === undefined) {
      resources.process.kill("SIGKILL");
      exitCode = await exitWithin(resources.process, terminateTimeoutMs);
    }
    if (exitCode === undefined) {
      throw new Error(
        `goal process did not exit within ${String(terminateTimeoutMs)}ms of SIGKILL`,
      );
    }
    const pumped = await settlesWithin(
      resources.stdoutPump,
      terminateTimeoutMs,
    );
    if (!pumped) {
      throw new Error("goal process output did not drain after exit");
    }
    return exitCode;
  } finally {
    await onSettled();
  }
}

async function exitWithin(
  process: GoalProcess,
  ms: number,
): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      process.exited,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function settlesWithin(
  promise: Promise<void>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
