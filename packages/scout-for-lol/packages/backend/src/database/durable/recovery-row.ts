import { z } from "zod";
import {
  RecoveryBatchSchema,
  type RecoveryBatch,
} from "@scout-for-lol/domain/recovery/batch.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Row codec for MatchRecoveryBatch.
 *
 * The RecoveryBatchState union is flattened: cursor columns exist only in
 * `scanning`, count columns only in `processing`, and the abandon reason only
 * in `abandoned` — the migration CHECKs make any other combination
 * unrepresentable, so a stored row always parses back into a well-formed
 * domain batch. `workflowId` is the Temporal retry-adoption key and is not
 * part of the domain value.
 */

export type MatchRecoveryBatchRecord = z.infer<
  typeof MatchRecoveryBatchRecordSchema
>;
export const MatchRecoveryBatchRecordSchema = z.strictObject({
  batch: RecoveryBatchSchema,
  workflowId: z.string().min(1).nullable(),
});

/** The columns owned by the state machine, written on every transition. */
export type RecoveryBatchStateColumns = {
  policy: string;
  state: string;
  cursorPosition: string | null;
  pagesScanned: number | null;
  pageBudget: number | null;
  discoveredCount: number | null;
  succeededCount: number | null;
  suppressedCount: number | null;
  failedCount: number | null;
  abandonReason: string | null;
};

/** Column shape of a MatchRecoveryBatch row, minus DB-managed columns. */
export type MatchRecoveryBatchRow = RecoveryBatchStateColumns & {
  recoveryBatchId: string;
  workflowId: string | null;
  createdAt: Date;
};

const RawRecoveryRowSchema = z.object({
  recoveryBatchId: z.string(),
  policy: z.string(),
  state: z.string(),
  cursorPosition: z.string().nullable(),
  pagesScanned: z.number().int().nullable(),
  pageBudget: z.number().int().nullable(),
  discoveredCount: z.number().int().nullable(),
  succeededCount: z.number().int().nullable(),
  suppressedCount: z.number().int().nullable(),
  failedCount: z.number().int().nullable(),
  abandonReason: z.string().nullable(),
  workflowId: z.string().nullable(),
  createdAt: z.date(),
});
type RawRecoveryRow = z.infer<typeof RawRecoveryRowSchema>;

function stateCandidate(raw: RawRecoveryRow): Record<string, unknown> {
  switch (raw.state) {
    case "planned":
    case "digesting":
    case "complete":
      return { kind: raw.state };
    case "scanning":
      return {
        kind: "scanning",
        cursor: {
          ...(raw.cursorPosition === null
            ? {}
            : { position: raw.cursorPosition }),
          pagesScanned: raw.pagesScanned,
          pageBudget: raw.pageBudget,
        },
      };
    case "processing":
      return {
        kind: "processing",
        counts: {
          discovered: raw.discoveredCount,
          succeeded: raw.succeededCount,
          suppressed: raw.suppressedCount,
          failed: raw.failedCount,
        },
      };
    case "abandoned":
      return { kind: "abandoned", reason: raw.abandonReason };
    default:
      throw new Error(`Unknown recovery state column value: ${raw.state}`);
  }
}

export function matchRecoveryBatchRowToRecord(
  row: unknown,
): MatchRecoveryBatchRecord {
  const raw = RawRecoveryRowSchema.parse(row);
  return MatchRecoveryBatchRecordSchema.parse({
    batch: {
      id: raw.recoveryBatchId,
      policy: raw.policy,
      createdAt: raw.createdAt.toISOString(),
      state: stateCandidate(raw),
    },
    workflowId: raw.workflowId,
  });
}

/**
 * The state-machine columns for one domain batch. Shared by the full row
 * mapper and by the guarded transition patch, so both write paths always
 * produce the same flattening.
 */
export function recoveryBatchStateColumns(
  batch: RecoveryBatch,
): RecoveryBatchStateColumns {
  const base: RecoveryBatchStateColumns = {
    policy: batch.policy,
    state: batch.state.kind,
    cursorPosition: null,
    pagesScanned: null,
    pageBudget: null,
    discoveredCount: null,
    succeededCount: null,
    suppressedCount: null,
    failedCount: null,
    abandonReason: null,
  };
  const state = batch.state;
  switch (state.kind) {
    case "planned":
    case "digesting":
    case "complete":
      return base;
    case "scanning":
      return {
        ...base,
        cursorPosition: state.cursor.position ?? null,
        pagesScanned: state.cursor.pagesScanned,
        pageBudget: state.cursor.pageBudget,
      };
    case "processing":
      return {
        ...base,
        discoveredCount: state.counts.discovered,
        succeededCount: state.counts.succeeded,
        suppressedCount: state.counts.suppressed,
        failedCount: state.counts.failed,
      };
    case "abandoned":
      return { ...base, abandonReason: state.reason };
  }
}

export function matchRecoveryBatchRecordToRow(
  record: MatchRecoveryBatchRecord,
): MatchRecoveryBatchRow {
  return {
    recoveryBatchId: record.batch.id,
    ...recoveryBatchStateColumns(record.batch),
    workflowId: record.workflowId,
    createdAt: dateFromIsoInstant(record.batch.createdAt),
  };
}
