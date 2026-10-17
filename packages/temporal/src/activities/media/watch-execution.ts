import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** Invoked inside each observation, never captured by the cached runtime. */
export function watchExecution(context = Context.current()) {
  const info = context.info;
  const required = [
    info.currentAttemptScheduledTimestampMs,
    info.startToCloseTimeoutMs,
    info.scheduledTimestampMs,
    info.scheduleToCloseTimeoutMs,
  ];
  if (required.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Watch Activity requires finite SDK deadlines");
  const wallDeadline = Math.min(
    info.currentAttemptScheduledTimestampMs + info.startToCloseTimeoutMs,
    info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
  );
  const monotonicDeadline =
    performance.now() + Math.max(0, wallDeadline - Date.now());
  const assertActive = () => {
    if (context.cancellationSignal.aborted)
      throw new CancelledFailure("Watch observation cancelled");
    if (Date.now() >= wallDeadline || performance.now() >= monotonicDeadline)
      throw ApplicationFailure.create({
        message: "Watch observation deadline exceeded",
        type: "WatchDeadlineExceeded",
      });
  };
  return {
    signal: context.cancellationSignal,
    assertActive,
    checkpoint: () => {
      assertActive();
      context.heartbeat({ phase: "watch-observation" });
      return Promise.resolve();
    },
  };
}

/** External errors may contain scoped Plex URLs; serialize only this category. */
export async function watchCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    const execution = watchExecution();
    execution.assertActive();
    const result = await work();
    execution.assertActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure)
      throw new CancelledFailure("Watch observation cancelled");
    throw ApplicationFailure.create({
      message: "Watch observation failed",
      type: "WatchObservationFailure",
    });
  }
}
