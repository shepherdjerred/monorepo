import type { Db } from "#src/database/index.ts";
import type {
  IsoInstant,
  WorkflowRunId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  scoutWorkflowStartRecordToRow,
  scoutWorkflowStartRowToRecord,
  type ScoutWorkflowStartRecord,
} from "#src/database/durable/workflow-start-row.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Repository for ScoutWorkflowStart.
 *
 * requestWorkflowStart is insert-or-adopt by the requested workflow id: a
 * crashed requester re-requesting the same start adopts the existing request
 * (including any acceptance already recorded) instead of starting a second
 * workflow. Adoption compares what identifies the start — type and input
 * payload — not when or by whom it was re-requested.
 */

export type RequestWorkflowStartResult =
  | { outcome: "applied"; record: ScoutWorkflowStartRecord }
  | { outcome: "adopted"; record: ScoutWorkflowStartRecord }
  | { outcome: "conflict"; reason: "request-differs" };

export async function requestWorkflowStart(
  db: Db,
  record: ScoutWorkflowStartRecord,
): Promise<RequestWorkflowStartResult> {
  const row = scoutWorkflowStartRecordToRow(record);
  const created = await db.scoutWorkflowStart.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied", record };
  }
  const existing = await db.scoutWorkflowStart.findUnique({
    where: { requestedWorkflowId: row.requestedWorkflowId },
  });
  if (existing === null) {
    throw new Error(
      `ScoutWorkflowStart ${row.requestedWorkflowId} vanished between a duplicate insert and its read-back`,
    );
  }
  const existingRecord = scoutWorkflowStartRowToRecord(existing);
  const identityMatches =
    existingRecord.workflowType === record.workflowType &&
    Bun.deepEquals(existingRecord.inputPayload, record.inputPayload, true);
  return identityMatches
    ? { outcome: "adopted", record: existingRecord }
    : { outcome: "conflict", reason: "request-differs" };
}

export type RecordWorkflowStartAcceptedResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "acceptance-differs" };

/**
 * Record that Temporal accepted the start. Guarded on the not-yet-accepted
 * row; a retry carrying the identical acceptance is `already-applied`, and a
 * different acceptance for an already-accepted start is a conflict.
 */
export async function recordWorkflowStartAccepted(
  db: Db,
  args: {
    requestedWorkflowId: string;
    acceptedAt: IsoInstant;
    runId: WorkflowRunId | null;
  },
): Promise<RecordWorkflowStartAcceptedResult> {
  const accepted = await db.scoutWorkflowStart.updateMany({
    where: { requestedWorkflowId: args.requestedWorkflowId, acceptedAt: null },
    data: {
      acceptedAt: dateFromIsoInstant(args.acceptedAt),
      runId: args.runId,
    },
  });
  if (accepted.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.scoutWorkflowStart.findUnique({
    where: { requestedWorkflowId: args.requestedWorkflowId },
  });
  if (existing === null) {
    throw new Error(
      `Cannot accept ${args.requestedWorkflowId}: the start was never requested`,
    );
  }
  const record = scoutWorkflowStartRowToRecord(existing);
  if (record.acceptance === null) {
    throw new Error(
      `Acceptance update for ${args.requestedWorkflowId} matched no row yet the start is unaccepted`,
    );
  }
  const sameAcceptance =
    dateFromIsoInstant(record.acceptance.acceptedAt).getTime() ===
      dateFromIsoInstant(args.acceptedAt).getTime() &&
    record.acceptance.runId === args.runId;
  return sameAcceptance
    ? { outcome: "already-applied" }
    : { outcome: "conflict", reason: "acceptance-differs" };
}

export async function getWorkflowStart(
  db: Db,
  args: { requestedWorkflowId: string },
): Promise<ScoutWorkflowStartRecord | null> {
  const row = await db.scoutWorkflowStart.findUnique({
    where: { requestedWorkflowId: args.requestedWorkflowId },
  });
  return row === null ? null : scoutWorkflowStartRowToRecord(row);
}
