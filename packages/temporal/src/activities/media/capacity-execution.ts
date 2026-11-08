import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** Conservative queue-inclusive deadline; no cached Activity context or signal. */
export function capacityExecution(context = Context.current()) {
  const info = context.info;
  const times = [
    info.scheduledTimestampMs,
    info.currentAttemptScheduledTimestampMs,
    info.scheduleToCloseTimeoutMs,
    info.startToCloseTimeoutMs,
  ];
  if (times.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Capacity Activity requires explicit finite deadlines");
  const wallDeadline = Math.min(
    info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
    info.currentAttemptScheduledTimestampMs + info.startToCloseTimeoutMs,
  );
  const monotonicDeadline =
    performance.now() + Math.max(0, wallDeadline - Date.now());
  const assertActive = () => {
    if (context.cancellationSignal.aborted)
      throw new CancelledFailure("Capacity observation cancelled");
    if (Date.now() >= wallDeadline || performance.now() >= monotonicDeadline)
      throw ApplicationFailure.create({
        message: "Capacity observation deadline exceeded",
        type: "CapacityDeadlineExceeded",
      });
  };
  return {
    signal: context.cancellationSignal,
    assertActive,
    checkpoint: () => {
      assertActive();
      context.heartbeat({ phase: "capacity-observation" });
      return Promise.resolve();
    },
  };
}

export async function capacityCall<T>(
  work: (execution: ReturnType<typeof capacityExecution>) => Promise<T>,
): Promise<T> {
  const execution = capacityExecution();
  try {
    execution.assertActive();
    const result = await work(execution);
    execution.assertActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    throw ApplicationFailure.create({
      message: "Capacity observation failed",
      type: "CapacityObservationFailure",
    });
  }
}
