import { z } from "zod";
import {
  IsoInstantSchema,
  WorkflowRunIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  dateFromIsoInstant,
  parsePayloadEnvelopeColumn,
  serializePayloadEnvelope,
  VersionedPayloadEnvelopeSchema,
} from "#src/database/durable/row-values.ts";

/**
 * Row codec for ScoutWorkflowStart.
 *
 * Acceptance is modelled as one nullable object because a run id is
 * acceptance evidence: it can never exist without `acceptedAt`, which the
 * migration CHECK also enforces. The domain has no brand for a Temporal
 * workflow id (only WorkflowRunId, the run id), so `requestedWorkflowId`
 * stays a plain non-empty string.
 *
 * Starts are typed by `workflowType`, and the input envelope's kind IS that
 * type — the expected-kind contract. The schema and a migration CHECK both
 * enforce it, so an envelope of some other kind can never be stored in, or
 * read out of, a start row.
 */

export type ScoutWorkflowStartRecord = z.infer<
  typeof ScoutWorkflowStartRecordSchema
>;
export const ScoutWorkflowStartRecordSchema = z
  .strictObject({
    requestedWorkflowId: z.string().min(1),
    workflowType: z.string().min(1),
    requestedBy: DiscordAccountIdSchema.nullable(),
    requestSource: z.string().min(1),
    inputPayload: VersionedPayloadEnvelopeSchema,
    requestedAt: IsoInstantSchema,
    acceptance: z
      .strictObject({
        acceptedAt: IsoInstantSchema,
        runId: WorkflowRunIdSchema.nullable(),
      })
      .nullable(),
  })
  .superRefine((record, ctx) => {
    if (record.inputPayload.kind !== record.workflowType) {
      ctx.addIssue({
        code: "custom",
        message: `input payload kind ${record.inputPayload.kind} does not match workflowType ${record.workflowType}`,
        path: ["inputPayload", "kind"],
      });
    }
  });

/** Column shape of a ScoutWorkflowStart row, minus DB-managed columns. */
export type ScoutWorkflowStartRow = {
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
      `Workflow start ${raw.requestedWorkflowId} carries a runId without acceptedAt`,
    );
  }
  return ScoutWorkflowStartRecordSchema.parse({
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
