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

export async function heartbeatWhile<T>(
  details: Record<string, unknown>,
  action: () => Promise<T>,
): Promise<T> {
  const context = Context.current();
  context.heartbeat(details);
  const timer = setInterval(() => {
    context.heartbeat(details);
  }, 10_000);
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}
