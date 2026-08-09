import { z } from "zod/v4";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";

const WorkflowFailureWatchCheckpointSchema = z.object({
  closeTime: z.iso.datetime({ offset: true }),
  workflowId: z.string().min(1),
  runId: z.string().min(1),
});

export type WorkflowFailureWatchCheckpoint = {
  closeTime: Date;
  workflowId: string;
  runId: string;
};

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
    workflowId: parsed.workflowId,
    runId: parsed.runId,
  };
}

export function serializedCheckpoint(
  checkpoint: WorkflowFailureWatchCheckpoint | undefined,
): Record<string, string> | null {
  return checkpoint === undefined
    ? null
    : {
        closeTime: checkpoint.closeTime.toISOString(),
        workflowId: checkpoint.workflowId,
        runId: checkpoint.runId,
      };
}

export function checkpointForExecution(
  execution: FailedWorkflowExecution,
): WorkflowFailureWatchCheckpoint {
  return {
    closeTime: execution.closeTime,
    workflowId: execution.workflowId,
    runId: execution.runId,
  };
}
