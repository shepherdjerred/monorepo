import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** Cached runtimes retain only this factory; each call obtains the current Activity. */
export function compensationExecution(context = Context.current()) {
  const info = context.info;
  if (
    [
      info.scheduledTimestampMs,
      info.currentAttemptScheduledTimestampMs,
      info.startToCloseTimeoutMs,
      info.scheduleToCloseTimeoutMs,
    ].some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new Error("Compensation Activity requires finite SDK deadlines");
  const wallDeadline = Math.min(
    info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
    info.currentAttemptScheduledTimestampMs + info.startToCloseTimeoutMs,
  );
  if (!Number.isSafeInteger(wallDeadline) || wallDeadline <= 0)
    throw new Error("Compensation Activity requires a safe SDK deadline");
  const monotonicDeadline =
    performance.now() + Math.max(0, wallDeadline - Date.now());
  const assertActive = () => {
    if (context.cancellationSignal.aborted)
      throw new CancelledFailure("Compensation Activity cancelled");
    if (Date.now() >= wallDeadline || performance.now() >= monotonicDeadline)
      throw ApplicationFailure.create({
        message: "Compensation Activity deadline exceeded",
        type: "CompensationDeadlineExceeded",
      });
  };
  return {
    expiresAtMs: wallDeadline,
    signal: context.cancellationSignal,
    assertActive,
    checkpoint: (phase: string) => {
      assertActive();
      context.heartbeat({ phase });
      return Promise.resolve();
    },
  };
}

export async function compensationCall<T>(
  work: (execution: ReturnType<typeof compensationExecution>) => Promise<T>,
): Promise<T> {
  try {
    const execution = compensationExecution();
    execution.assertActive();
    const result = await work(execution);
    execution.assertActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure)
      throw new CancelledFailure("Compensation Activity cancelled");
    throw ApplicationFailure.create({
      message:
        "Compensation Activity failed; review protected operation status",
      type: "CompensationActivityFailure",
    });
  }
}

export function compensationRuntimeCall<R, T>(
  load: () => Promise<R>,
  work: (
    runtime: R,
    execution: ReturnType<typeof compensationExecution>,
  ) => Promise<T>,
): Promise<T> {
  return compensationCall(async (execution) => {
    const runtime = await load();
    execution.assertActive();
    return work(runtime, execution);
  });
}
