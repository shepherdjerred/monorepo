import { z } from "zod";
import {
  ScoutWorkflowStartRecordSchema,
  type ScoutWorkflowStartRecord,
} from "@scout-for-lol/domain/recovery/workflow-start.ts";
import {
  dateFromIsoInstant,
  parsePayloadEnvelopeColumn,
  serializePayloadEnvelope,
} from "#src/database/durable/row-values.ts";

/**
 * Row codec for ScoutWorkflowStart.
 *
 * The record contract is the domain's (`recovery/workflow-start`); this module
 * only maps it onto the column shape and back.
 *
 * Acceptance is one nullable object because a run id is acceptance evidence:
 * it can never exist without `acceptedAt`, which the migration CHECK also
 * enforces. The request key is the row's primary key and the workflow id is
 * an ordinary indexed column; the domain has no brand for a Temporal workflow
 * id (only WorkflowRunId, the run id), so `requestedWorkflowId` stays a plain
 * non-empty string.
 *
 * The expected-kind contract — a start's input envelope kind IS its workflow
 * type — is enforced by the domain schema on the way out and by a migration
 * CHECK on the way in, so an envelope of some other kind can never be stored
 * in, or read out of, a start row.
 */

/** Column shape of a ScoutWorkflowStart row, minus DB-managed columns. */
export type ScoutWorkflowStartRow = {
  requestId: string;
  requestedWorkflowId: string;
  workflowType: string;
  requestedBy: string | null;
  requestSource: string;
  inputPayload: string;
  requestedAt: Date;
  acceptedAt: Date | null;
  runId: string | null;
};

const RawWorkflowStartRowSchema = z.object({
  requestId: z.string(),
  requestedWorkflowId: z.string(),
  workflowType: z.string(),
  requestedBy: z.string().nullable(),
  requestSource: z.string(),
  inputPayload: z.string(),
  requestedAt: z.date(),
  acceptedAt: z.date().nullable(),
  runId: z.string().nullable(),
});

export function scoutWorkflowStartRowToRecord(
  row: unknown,
): ScoutWorkflowStartRecord {
  const raw = RawWorkflowStartRowSchema.parse(row);
  if (raw.acceptedAt === null && raw.runId !== null) {
    throw new Error(
      `Workflow start request ${raw.requestId} carries a runId without acceptedAt`,
    );
  }
  return ScoutWorkflowStartRecordSchema.parse({
    requestId: raw.requestId,
    requestedWorkflowId: raw.requestedWorkflowId,
    workflowType: raw.workflowType,
    requestedBy: raw.requestedBy,
    requestSource: raw.requestSource,
    inputPayload: parsePayloadEnvelopeColumn(raw.inputPayload),
    requestedAt: raw.requestedAt.toISOString(),
    acceptance:
      raw.acceptedAt === null
        ? null
        : { acceptedAt: raw.acceptedAt.toISOString(), runId: raw.runId },
  });
}

export function scoutWorkflowStartRecordToRow(
  record: ScoutWorkflowStartRecord,
): ScoutWorkflowStartRow {
  return {
    requestId: record.requestId,
    requestedWorkflowId: record.requestedWorkflowId,
    workflowType: record.workflowType,
    requestedBy: record.requestedBy,
    requestSource: record.requestSource,
    inputPayload: serializePayloadEnvelope(record.inputPayload),
    requestedAt: dateFromIsoInstant(record.requestedAt),
    acceptedAt:
      record.acceptance === null
        ? null
        : dateFromIsoInstant(record.acceptance.acceptedAt),
    runId: record.acceptance?.runId ?? null,
  };
}
