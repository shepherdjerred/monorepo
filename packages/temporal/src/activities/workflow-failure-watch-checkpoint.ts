import { z } from "zod/v4";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";
import {
  TemporalNamespaceSchema,
  type TemporalNamespace,
} from "#shared/temporal-namespace.ts";
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
export type WorkflowFailureWatchCheckpoints = Partial<
  Record<
    TemporalNamespace,
    WorkflowFailureWatchCheckpoint | WorkflowFailureWatchCursor
  >
>;

export function workflowExecutionKey(
  workflowId: string,
  runId: string,
): string {
  return `${workflowId}\u{0000}${runId}`;
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

function serializedCheckpoint(
  checkpoint:
    WorkflowFailureWatchCheckpoint | WorkflowFailureWatchCursor | undefined,
): Record<string, unknown> | null {
  if (checkpoint === undefined) return null;
  if ("closeTime" in checkpoint) return serializeCursor(checkpoint);
  return serializeDetailedCheckpoint(checkpoint);
}

function serializeDetailedCheckpoint(
  checkpoint: WorkflowFailureWatchCheckpoint,
): Record<string, unknown> {
  return {
    detailedAlertsConsumed: checkpoint.detailedAlertsConsumed,
    ...serializeOverflow(checkpoint.overflow),
    ...serializeCursorField(checkpoint.cursor),
  };
}

function serializeOverflow(
  overflow: WorkflowFailureOverflowSummary | undefined,
): Record<string, unknown> {
  if (overflow === undefined) return {};
  return {
    overflow: {
      ...overflow,
      newestOmittedCloseTime: overflow.newestOmittedCloseTime.toISOString(),
    },
  };
}

function serializeCursorField(
  cursor: WorkflowFailureWatchCursor | undefined,
): Record<string, unknown> {
  if (cursor === undefined) return {};
  return { cursor: serializeCursor(cursor) };
}

function serializeCursor(
  cursor: WorkflowFailureWatchCursor,
): Record<string, unknown> {
  return {
    closeTime: cursor.closeTime.toISOString(),
    ...(cursor.startTime === undefined
      ? {}
      : { startTime: cursor.startTime.toISOString() }),
    ...(cursor.lookbackSince === undefined
      ? {}
      : { lookbackSince: cursor.lookbackSince.toISOString() }),
    workflowId: cursor.workflowId,
    runId: cursor.runId,
    ...(cursor.processedExecutionKeys === undefined
      ? {}
      : { processedExecutionKeys: cursor.processedExecutionKeys }),
  };
}

export function parseWorkflowFailureWatchCheckpoints(
  details: unknown,
): WorkflowFailureWatchCheckpoints {
  if (details === undefined) return {};
  const detailsRecord = z.record(z.string(), z.unknown()).parse(details);
  const rawCheckpoints = detailsRecord["checkpoints"];
  if (rawCheckpoints === undefined || rawCheckpoints === null) return {};
  const checkpointsRecord = z
    .record(z.string(), z.unknown())
    .parse(rawCheckpoints);
  return Object.fromEntries(
    Object.entries(checkpointsRecord).map(([namespace, checkpoint]) => [
      TemporalNamespaceSchema.parse(namespace),
      parseCheckpointValue(checkpoint),
    ]),
  );
}

function parseCheckpointValue(
  value: unknown,
): WorkflowFailureWatchCheckpoint | WorkflowFailureWatchCursor {
  const parsedCheckpoint =
    WorkflowFailureWatchCheckpointSchema.safeParse(value);
  if (parsedCheckpoint.success) {
    return {
      detailedAlertsConsumed: parsedCheckpoint.data.detailedAlertsConsumed,
      ...(parsedCheckpoint.data.overflow === undefined
        ? {}
        : {
            overflow: {
              ...parsedCheckpoint.data.overflow,
              newestOmittedCloseTime: new Date(
                parsedCheckpoint.data.overflow.newestOmittedCloseTime,
              ),
            },
          }),
      ...(parsedCheckpoint.data.cursor === undefined
        ? {}
        : { cursor: parsedCursor(parsedCheckpoint.data.cursor) }),
    };
  }
  return parsedCursor(WorkflowFailureWatchCursorSchema.parse(value));
}

export function serializedCheckpoints(
  checkpoints: WorkflowFailureWatchCheckpoints,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(checkpoints).map(([namespace, checkpoint]) => [
      namespace,
      serializedCheckpoint(checkpoint),
    ]),
  );
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
