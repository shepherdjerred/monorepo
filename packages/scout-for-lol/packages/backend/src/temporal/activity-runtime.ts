import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type {
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
} from "@scout-for-lol/temporal/contracts";

export function unavailable(activity: string): never {
  throw ApplicationFailure.nonRetryable(
    `Scout Temporal activity ${activity} has no enabled workload owner`,
    "DisabledWorkload",
  );
}

export function probeQueue(
  input: ScoutQueueCanaryProbeInput,
): Promise<ScoutQueueCanaryProbeResult> {
  const taskQueue = Context.current().info.taskQueue;
  Context.current().heartbeat({
    canaryId: input.canaryId,
    queueClass: input.queueClass,
    taskQueue,
  });
  return Promise.resolve({ ...input, taskQueue });
}

/**
 * How often to beat, as a fraction of the Activity's own heartbeat timeout.
 *
 * A fixed interval equal to the timeout is a race the Activity loses about
 * half the time: the server's timer fires at `last heartbeat + timeout`, and
 * the next beat is issued at exactly that instant. A live Activity killed that
 * way reaches its Workflow as a bare timeout — which, for the notification
 * send, is indistinguishable from a Discord request that went unanswered and
 * is recorded as `unknown-delivery`. A third of the timeout leaves room for
 * two missed beats before the server gives up; the SDK throttles what actually
 * reaches the server to 80% of the timeout, so beating more often is free.
 */
const HEARTBEAT_INTERVAL_DIVISOR = 3;
const MINIMUM_HEARTBEAT_INTERVAL_MS = 1000;
/** For an Activity whose options set no heartbeat timeout: nothing can lapse. */
const UNTIMED_HEARTBEAT_INTERVAL_MS = 10_000;

function heartbeatIntervalMs(heartbeatTimeoutMs: number | undefined): number {
  return heartbeatTimeoutMs === undefined
    ? UNTIMED_HEARTBEAT_INTERVAL_MS
    : Math.max(
        MINIMUM_HEARTBEAT_INTERVAL_MS,
        Math.floor(heartbeatTimeoutMs / HEARTBEAT_INTERVAL_DIVISOR),
      );
}

export async function heartbeatWhile<T>(
  details: Record<string, unknown>,
  action: () => Promise<T>,
): Promise<T> {
  const context = Context.current();
  context.heartbeat(details);
  const timer = setInterval(() => {
    context.heartbeat(details);
  }, heartbeatIntervalMs(context.info.heartbeatTimeoutMs));
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}
