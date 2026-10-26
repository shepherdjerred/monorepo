import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** The cached runtime retains this factory, never its invocation's context or signal. */
export function archiveExecution(context = Context.current()) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const info = context.info;
  if (
    [
      info.scheduledTimestampMs,
      info.currentAttemptScheduledTimestampMs,
      info.startToCloseTimeoutMs,
      info.scheduleToCloseTimeoutMs,
    ].some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new Error("Archive Activity requires finite SDK deadlines");
  const wallDeadline = Math.min(
    info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
    info.currentAttemptScheduledTimestampMs + info.startToCloseTimeoutMs,
  );
  const monotonicDeadline =
    observed.monotonic + Math.max(0, wallDeadline - observed.wall);
  const assertActive = () => {
    if (context.cancellationSignal.aborted)
      throw new CancelledFailure("Archive Activity cancelled");
    if (Date.now() >= wallDeadline || performance.now() >= monotonicDeadline)
      throw ApplicationFailure.create({
        message: "Archive Activity deadline exceeded",
        type: "ArchiveDeadlineExceeded",
      });
  };
  return {
    observed,
    expiresAtMs: wallDeadline,
    signal: context.cancellationSignal,
    assertActive,
    checkpoint: () => {
      assertActive();
      context.heartbeat({ phase: "native-archive" });
      return Promise.resolve();
    },
  };
}

export async function archiveCall<T>(
  work: (execution: ReturnType<typeof archiveExecution>) => Promise<T>,
): Promise<T> {
  try {
    const execution = archiveExecution();
    execution.assertActive();
    const result = await work(execution);
    execution.assertActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure)
      throw new CancelledFailure("Archive Activity cancelled");
    throw ApplicationFailure.create({
      message: "Archive Activity failed; review protected operation status",
      type: "ArchiveActivityFailure",
    });
  }
}
