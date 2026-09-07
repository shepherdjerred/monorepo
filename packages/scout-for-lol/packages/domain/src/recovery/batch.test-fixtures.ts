import {
  IsoInstantSchema,
  RecoveryBatchIdSchema,
} from "#src/identity/brands.ts";
import type {
  RecoveryBatch,
  RecoveryBatchState,
  RecoveryCounts,
  RecoveryPolicy,
  RecoveryScanCursor,
} from "#src/recovery/batch.ts";

/** Shared literals for the recovery-batch test suites. */

export const batchId = RecoveryBatchIdSchema.parse(
  "0f8b4c2a-3d5e-4b6f-8a9c-1d2e3f405060",
);
export const createdAt = IsoInstantSchema.parse("2026-09-01T12:00:00.000Z");

export function makeBatch(
  state: RecoveryBatchState,
  policy: RecoveryPolicy = "normal",
): RecoveryBatch {
  return { id: batchId, policy, createdAt, state };
}

export function scanningState(
  cursor: Partial<RecoveryScanCursor> = {},
): Extract<RecoveryBatchState, { kind: "scanning" }> {
  return {
    kind: "scanning",
    cursor: { pagesScanned: 0, pageBudget: 3, ...cursor },
  };
}

export function countsOf(
  overrides: Partial<RecoveryCounts> = {},
): RecoveryCounts {
  return {
    discovered: 10,
    succeeded: 0,
    suppressed: 0,
    failed: 0,
    ...overrides,
  };
}

export function processingState(
  overrides: Partial<RecoveryCounts> = {},
): Extract<RecoveryBatchState, { kind: "processing" }> {
  return { kind: "processing", counts: countsOf(overrides) };
}

/** One representative state per kind, for exhaustive source-state tables. */
export function statesByKind(): Record<
  RecoveryBatchState["kind"],
  RecoveryBatchState
> {
  return {
    planned: { kind: "planned" },
    scanning: scanningState(),
    processing: processingState(),
    digesting: { kind: "digesting" },
    complete: { kind: "complete" },
    abandoned: { kind: "abandoned", reason: "operator-cancelled" },
  };
}
