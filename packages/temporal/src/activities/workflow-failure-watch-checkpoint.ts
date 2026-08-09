import { z } from "zod/v4";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";

const WorkflowFailureWatchCheckpointSchema = z.object({
  closeTime: z.iso.datetime({ offset: true }),
  // Optional for heartbeats written before the stable visibility cursor was
  // introduced. New checkpoints always include it.
  startTime: z.iso.datetime({ offset: true }).optional(),
  lookbackSince: z.iso.datetime({ offset: true }).optional(),
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  // The Temporal SDK exposes visibility timestamps as millisecond-precision
  // Dates even when the server's protobuf timestamps have nanoseconds. Keep
  // the exact IDs completed in the current close-millisecond cohort so a
  // retry can replay unseen rows without skipping them or retrying the first
  // batch forever.
  processedExecutionKeys: z.array(z.string().min(1)).optional(),
});

export type WorkflowFailureWatchCheckpoint = {
  closeTime: Date;
  startTime: Date | undefined;
  lookbackSince?: Date;
  workflowId: string;
  runId: string;
  processedExecutionKeys?: string[];
};

export function workflowExecutionKey(
  workflowId: string,
  runId: string,
): string {
  return `${workflowId}\u{0000}${runId}`;
}

/**
 * Decode the last heartbeat from a retrying activity. Heartbeats from the
 * pre-checkpoint implementation have no `checkpoint` field and intentionally
 * resume from the lookback boundary; malformed checkpoint data fails loudly so
 * a broken progress contract cannot silently skip executions.
 */
export function parseWorkflowFailureWatchCheckpoint(
  details: unknown,
): WorkflowFailureWatchCheckpoint | undefined {
  if (details === undefined) {
    return undefined;
  }
  const detailsRecord = z.record(z.string(), z.unknown()).parse(details);
  const checkpoint = detailsRecord["checkpoint"];
  if (checkpoint === undefined || checkpoint === null) {
    return undefined;
  }
  const parsed = WorkflowFailureWatchCheckpointSchema.parse(checkpoint);
  return {
    closeTime: new Date(parsed.closeTime),
    startTime:
      parsed.startTime === undefined ? undefined : new Date(parsed.startTime),
    ...(parsed.lookbackSince === undefined
      ? {}
      : { lookbackSince: new Date(parsed.lookbackSince) }),
    workflowId: parsed.workflowId,
    runId: parsed.runId,
    ...(parsed.processedExecutionKeys === undefined
      ? {}
      : { processedExecutionKeys: parsed.processedExecutionKeys }),
  };
}

export function parseWorkflowFailureWatchLookbackSince(
  details: unknown,
): Date | undefined {
  if (details === undefined) {
    return undefined;
  }
  const detailsRecord = z.record(z.string(), z.unknown()).parse(details);
  const lookbackSince = detailsRecord["lookbackSince"];
  if (lookbackSince === undefined) {
    return undefined;
  }
  return new Date(z.iso.datetime({ offset: true }).parse(lookbackSince));
}

export function serializedCheckpoint(
  checkpoint: WorkflowFailureWatchCheckpoint | undefined,
): Record<string, unknown> | null {
  return checkpoint === undefined
    ? null
    : {
        closeTime: checkpoint.closeTime.toISOString(),
        ...(checkpoint.startTime === undefined
          ? {}
          : { startTime: checkpoint.startTime.toISOString() }),
        ...(checkpoint.lookbackSince === undefined
          ? {}
          : { lookbackSince: checkpoint.lookbackSince.toISOString() }),
        workflowId: checkpoint.workflowId,
        runId: checkpoint.runId,
        ...(checkpoint.processedExecutionKeys === undefined
          ? {}
          : { processedExecutionKeys: checkpoint.processedExecutionKeys }),
      };
}

export function checkpointForExecution(
  execution: FailedWorkflowExecution,
  lookbackSince?: Date,
): WorkflowFailureWatchCheckpoint {
  return {
    closeTime: execution.closeTime,
    startTime: execution.startTime,
    ...(lookbackSince === undefined ? {} : { lookbackSince }),
    workflowId: execution.workflowId,
    runId: execution.runId,
    processedExecutionKeys: [
      workflowExecutionKey(execution.workflowId, execution.runId),
    ],
  };
}
