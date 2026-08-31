import { z } from "zod/v4";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import type { WorkflowFailureOverflowSummary } from "./workflow-failure-watch-overflow.ts";

const WorkflowFailureWatchCursorSchema = z.object({
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

const WorkflowFailureWatchCheckpointSchema = z.object({
  detailedAlertsConsumed: z.number().int().nonnegative(),
  cursor: WorkflowFailureWatchCursorSchema.optional(),
  overflow: z
    .object({
      omitted: z.number().int().positive(),
      counts: z.record(z.string(), z.number().int().positive()),
      newestOmittedCloseTime: z.iso.datetime({ offset: true }),
    })
    .optional(),
});

export type WorkflowFailureWatchCursor = {
  closeTime: Date;
  startTime: Date | undefined;
  lookbackSince?: Date;
  workflowId: string;
  runId: string;
  processedExecutionKeys?: string[];
};

export type WorkflowFailureWatchCheckpoint = {
  detailedAlertsConsumed: number;
  cursor?: WorkflowFailureWatchCursor;
  overflow?: WorkflowFailureOverflowSummary;
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
  const parsed = WorkflowFailureWatchCheckpointSchema.safeParse(checkpoint);
  if (parsed.success) {
    return {
      detailedAlertsConsumed: parsed.data.detailedAlertsConsumed,
      ...(parsed.data.cursor === undefined
        ? {}
        : { cursor: parsedCursor(parsed.data.cursor) }),
      ...(parsed.data.overflow === undefined
        ? {}
        : {
            overflow: {
              ...parsed.data.overflow,
              newestOmittedCloseTime: new Date(
                parsed.data.overflow.newestOmittedCloseTime,
              ),
            },
          }),
    };
  }
  // Heartbeats written before the fanout budget used the cursor fields at the
  // checkpoint root. They consumed no persisted detail budget.
  const legacyCursor = WorkflowFailureWatchCursorSchema.parse(checkpoint);
  return {
    detailedAlertsConsumed: 0,
    cursor: parsedCursor(legacyCursor),
  };
}

function parsedCursor(
  parsed: z.infer<typeof WorkflowFailureWatchCursorSchema>,
): WorkflowFailureWatchCursor {
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
        detailedAlertsConsumed: checkpoint.detailedAlertsConsumed,
        ...(checkpoint.overflow === undefined
          ? {}
          : {
              overflow: {
                ...checkpoint.overflow,
                newestOmittedCloseTime:
                  checkpoint.overflow.newestOmittedCloseTime.toISOString(),
              },
            }),
        ...(checkpoint.cursor === undefined
          ? {}
          : {
              cursor: {
                closeTime: checkpoint.cursor.closeTime.toISOString(),
                ...(checkpoint.cursor.startTime === undefined
                  ? {}
                  : { startTime: checkpoint.cursor.startTime.toISOString() }),
                ...(checkpoint.cursor.lookbackSince === undefined
                  ? {}
                  : {
                      lookbackSince:
                        checkpoint.cursor.lookbackSince.toISOString(),
                    }),
                workflowId: checkpoint.cursor.workflowId,
                runId: checkpoint.cursor.runId,
                ...(checkpoint.cursor.processedExecutionKeys === undefined
                  ? {}
                  : {
                      processedExecutionKeys:
                        checkpoint.cursor.processedExecutionKeys,
                    }),
              },
            }),
      };
}

export function checkpointForExecution(
  execution: FailedWorkflowExecution,
  lookbackSince?: Date,
  detailedAlertsConsumed = 0,
): WorkflowFailureWatchCheckpoint {
  return {
    detailedAlertsConsumed,
    cursor: {
      closeTime: execution.closeTime,
      startTime: execution.startTime,
      ...(lookbackSince === undefined ? {} : { lookbackSince }),
      workflowId: execution.workflowId,
      runId: execution.runId,
      processedExecutionKeys: [
        workflowExecutionKey(execution.workflowId, execution.runId),
      ],
    },
  };
}
