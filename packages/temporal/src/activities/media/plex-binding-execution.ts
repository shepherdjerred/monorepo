import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";

/** Capture before the runtime/configuration await; cached runtimes never own this object. */
export function plexBindingExecution(
  context = Context.current(),
): PlexBindingExecution {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const info = context.info;
  if (
    [
      info.scheduledTimestampMs,
      info.currentAttemptScheduledTimestampMs,
      info.startToCloseTimeoutMs,
      info.scheduleToCloseTimeoutMs,
    ].some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("Plex binding Activity requires finite SDK deadlines");
  }
  const sdkDeadline = Math.min(
    info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
    info.currentAttemptScheduledTimestampMs + info.startToCloseTimeoutMs,
  );
  const monotonicDeadline = observed.monotonic + sdkDeadline - observed.wall;
  const expiresAtMs = Math.floor(Math.min(observed.wall + 60_000, sdkDeadline));
  if (
    !Number.isSafeInteger(sdkDeadline) ||
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isFinite(monotonicDeadline)
  ) {
    throw new TypeError("Plex binding Activity deadline is invalid");
  }
  const assertActive = () => {
    if (context.cancellationSignal.aborted) {
      throw new CancelledFailure("Plex binding Activity cancelled");
    }
    const wall = Date.now();
    if (
      wall < observed.wall ||
      wall >= sdkDeadline ||
      performance.now() >= monotonicDeadline
    ) {
      throw ApplicationFailure.create({
        message: "Plex binding Activity deadline exceeded",
        type: "PlexBindingDeadlineExceeded",
      });
    }
  };
  return {
    observed,
    expiresAtMs,
    signal: context.cancellationSignal,
    assertActive,
    checkpoint: () => {
      assertActive();
      context.heartbeat({ phase: "plex-binding" });
      return Promise.resolve();
    },
  };
}

export async function plexBindingCall<T>(
  work: (execution: PlexBindingExecution) => Promise<T>,
): Promise<T> {
  try {
    const execution = plexBindingExecution();
    execution.assertActive();
    const result = await work(execution);
    execution.assertActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure) {
      throw new CancelledFailure("Plex binding Activity cancelled");
    }
    throw ApplicationFailure.create({
      message:
        "Plex binding Activity failed; inspect protected operation status",
      type: "PlexBindingActivityFailure",
    });
  }
}
