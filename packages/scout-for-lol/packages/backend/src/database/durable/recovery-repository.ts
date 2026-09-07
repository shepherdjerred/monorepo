import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { RecoveryBatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { RecoveryBatch } from "@scout-for-lol/domain/recovery/batch.ts";
import {
  advanceScanCursor,
  type RecoveryTransitionResult,
} from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import {
  matchRecoveryBatchRecordToRow,
  matchRecoveryBatchRowToRecord,
  recoveryBatchStateColumns,
  type MatchRecoveryBatchRecord,
} from "#src/database/durable/recovery-row.ts";

/**
 * Repository for MatchRecoveryBatch.
 *
 * Transitions run the pure domain machine over a parsed snapshot and write
 * the result behind a guard on every state-machine column that snapshot
 * observed, so a delayed retry of an earlier cursor advance conflicts through
 * the domain's own `stale-cursor` answer rather than rewinding the cursor.
 */

type RecoveryDb = Pick<ExtendedPrismaClient, "matchRecoveryBatch">;

const TRANSITION_ATTEMPTS = 3;

export type CreateRecoveryBatchResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | {
      outcome: "conflict";
      reason: "batch-differs" | "workflow-adopted-by-another-batch";
    };

/**
 * Create one recovery batch. Identical retries are `already-applied`. A
 * skipped insert with no row under this batch id means the unique workflowId
 * collided with a different batch — the adoption key is already spoken for.
 */
export async function createRecoveryBatch(
  db: RecoveryDb,
  record: MatchRecoveryBatchRecord,
): Promise<CreateRecoveryBatchResult> {
  const row = matchRecoveryBatchRecordToRow(record);
  const created = await db.matchRecoveryBatch.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchRecoveryBatch.findUnique({
    where: { recoveryBatchId: row.recoveryBatchId },
  });
  if (existing === null) {
    return {
      outcome: "conflict",
      reason: "workflow-adopted-by-another-batch",
    };
  }
  const existingRow = matchRecoveryBatchRecordToRow(
    matchRecoveryBatchRowToRecord(existing),
  );
  return Bun.deepEquals(existingRow, row, true)
    ? { outcome: "already-applied" }
    : { outcome: "conflict", reason: "batch-differs" };
}

export async function getRecoveryBatch(
  db: RecoveryDb,
  args: { recoveryBatchId: RecoveryBatchId },
): Promise<MatchRecoveryBatchRecord | null> {
  const row = await db.matchRecoveryBatch.findUnique({
    where: { recoveryBatchId: args.recoveryBatchId },
  });
  return row === null ? null : matchRecoveryBatchRowToRecord(row);
}

/**
 * Apply one pure domain transition to the stored batch, guarded by the full
 * state-machine column set the snapshot observed (policy included, because
 * operatorReleasePolicy transitions it). A guard miss re-evaluates against
 * the fresh state so a lost race returns the domain's own non-applied answer.
 */
export async function transitionRecoveryBatch(
  db: RecoveryDb,
  args: {
    recoveryBatchId: RecoveryBatchId;
    transition: (batch: RecoveryBatch) => RecoveryTransitionResult;
  },
): Promise<RecoveryTransitionResult> {
  for (let attempt = 0; attempt < TRANSITION_ATTEMPTS; attempt += 1) {
    const row = await db.matchRecoveryBatch.findUnique({
      where: { recoveryBatchId: args.recoveryBatchId },
    });
    if (row === null) {
      throw new Error(
        `Cannot transition ${args.recoveryBatchId}: the batch was never created`,
      );
    }
    const record = matchRecoveryBatchRowToRecord(row);
    const result = args.transition(record.batch);
    if (result.outcome !== "applied") {
      return result;
    }
    const updated = await db.matchRecoveryBatch.updateMany({
      where: {
        recoveryBatchId: args.recoveryBatchId,
        ...recoveryBatchStateColumns(record.batch),
      },
      data: recoveryBatchStateColumns(result.next),
    });
    if (updated.count === 1) {
      return result;
    }
  }
  throw new Error(
    `Gave up transitioning ${args.recoveryBatchId} after ${String(TRANSITION_ATTEMPTS)} contended attempts`,
  );
}

/**
 * Advance the scan cursor by one page, guarded by the caller's expected
 * position exactly as the domain transition defines it.
 */
export async function advanceRecoveryCursor(
  db: RecoveryDb,
  args: {
    recoveryBatchId: RecoveryBatchId;
    expectedPosition: string | undefined;
    nextPosition: string;
  },
): Promise<RecoveryTransitionResult> {
  return await transitionRecoveryBatch(db, {
    recoveryBatchId: args.recoveryBatchId,
    transition: (batch) =>
      advanceScanCursor(batch, {
        expectedPosition: args.expectedPosition,
        nextPosition: args.nextPosition,
      }),
  });
}
