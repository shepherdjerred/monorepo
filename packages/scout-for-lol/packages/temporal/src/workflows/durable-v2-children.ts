import { startChild } from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type { ScoutStage } from "#src/contracts.ts";
import type { ScoutReconciliationScanV2Result } from "#src/activity-contracts-v2.ts";
import {
  SCOUT_V2_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  type ScoutV2ReusePolicy,
  scoutLakeProjectionV2WorkflowId,
  scoutMatchProcessingV2WorkflowId,
  scoutNotificationV2WorkflowId,
  scoutRecoveryBatchV2WorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutMatchProcessingV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import { IMPLEMENTED_V2_FAN_OUT_WORKFLOWS } from "./match-fan-out-v2.ts";

/**
 * Turning one reconciliation page into child starts.
 *
 * This lives beside `durable-v2.ts` rather than inside it because the four
 * families differ only in three values — Workflow Type, ID and serialized
 * input — and expressing that as one table plus one starter keeps the
 * reuse-policy decision visible per family instead of buried in four
 * near-identical `startChild` calls.
 *
 * Every child ID is derived from the work itself, so a sweep that rediscovers
 * an item already being driven collapses onto that execution rather than
 * racing a duplicate. `parentClosePolicy: "ABANDON"` throughout: a
 * reconciliation run is a sweep, not an owner, and its own completion — or its
 * Continue-As-New — must never cancel the work it started.
 */

export const RECONCILIATION_CHILD_FAMILIES_V2 = [
  "matchProcessing",
  "notifications",
  "lakeProjections",
  "recoveryBatches",
] as const;
export type ScoutReconciliationChildFamilyV2 =
  (typeof RECONCILIATION_CHILD_FAMILIES_V2)[number];

export type ScoutReconciliationChildCountsV2 = Record<
  ScoutReconciliationChildFamilyV2,
  number
>;

export function emptyReconciliationChildCountsV2(): ScoutReconciliationChildCountsV2 {
  return {
    matchProcessing: 0,
    notifications: 0,
    lakeProjections: 0,
    recoveryBatches: 0,
  };
}

/**
 * Which V2 Workflow Types the reconciliation sweep may start.
 *
 * The gate exists because starting a Workflow whose body is still an
 * `unimplementedV2Workflow` stub would not defer the work, it would destroy
 * it: the stub fails NON-RETRYABLY, and every ID below is derived from the
 * work itself, so the failed execution would own the ID that every later sweep
 * computes for the same work.
 *
 * DERIVED from `IMPLEMENTED_V2_FAN_OUT_WORKFLOWS` rather than restating it, so
 * the two start sites cannot drift. That list answers a narrower question —
 * which of the two children a MATCH fans out to has a body — and is typed by
 * `ScoutMatchFanOutChildV2["workflowType"]` accordingly, so it could never
 * name the other two types this sweep starts. Spreading it and adding those
 * two keeps one source of truth for the overlap: a lane that lands a
 * notification or lake body edits the allowlist, and the sweep follows without
 * anyone remembering to edit a second list.
 *
 * Match processing and recovery batches are named here because nothing fans
 * out to them; the sweep is their only automated starter.
 */
const RECONCILIATION_STARTABLE_V2: ReadonlySet<string> = new Set<string>([
  ...IMPLEMENTED_V2_FAN_OUT_WORKFLOWS,
  SCOUT_WORKFLOW_NAMES.matchProcessingV2,
  SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
]);

/**
 * Why a family reuses IDs the way it does is answered by
 * `SCOUT_V2_REUSE_POLICIES` in `identifiers.ts`, which carries the reasoning.
 * The sweep reads that table rather than restating its values, because the
 * operations API's operator starts re-drive the same families from the backend
 * and the two starters must never disagree about the terms of a start.
 */
type ReconciliationChildV2 = {
  readonly workflowType: string;
  readonly workflowId: string;
  readonly input: unknown;
  readonly reuse: ScoutV2ReusePolicy;
};

function childrenOfFamily(
  stage: ScoutStage,
  family: ScoutReconciliationChildFamilyV2,
  pending: ScoutReconciliationScanV2Result["pending"],
): readonly ReconciliationChildV2[] {
  switch (family) {
    case "matchProcessing":
      return pending.matchProcessing.map((riotMatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.matchProcessingV2,
        workflowId: scoutMatchProcessingV2WorkflowId(stage, riotMatchId),
        input: scoutMatchProcessingV2InputCodec.serialize({
          stage,
          riotMatchId,
        }),
        reuse: SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.matchProcessingV2],
      }));
    case "notifications":
      return pending.notifications.map((intentKey) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
        workflowId: scoutNotificationV2WorkflowId(stage, intentKey),
        input: scoutNotificationV2InputCodec.serialize({ stage, intentKey }),
        reuse: SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notificationV2],
      }));
    case "lakeProjections":
      return pending.lakeProjections.map((riotMatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
        workflowId: scoutLakeProjectionV2WorkflowId(stage, riotMatchId),
        input: scoutLakeProjectionV2InputCodec.serialize({
          stage,
          riotMatchId,
        }),
        reuse: SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjectionV2],
      }));
    case "recoveryBatches":
      return pending.recoveryBatches.map((recoveryBatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
        workflowId: scoutRecoveryBatchV2WorkflowId(stage, recoveryBatchId),
        input: scoutRecoveryBatchV2InputCodec.serialize({
          stage,
          recoveryBatchId,
        }),
        reuse: SCOUT_V2_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.recoveryBatchV2],
      }));
  }
}

/**
 * Start one child, treating an ID already in use as an answer rather than a
 * fault.
 *
 * The sweep does not wait for the child, and that is deliberate: waiting would
 * let one slow notification hold up every other item the page found, and these
 * children are abandoned by design, so their outcomes are their own to report.
 */
async function startReconciliationChildV2(
  stage: ScoutStage,
  child: ReconciliationChildV2,
): Promise<boolean> {
  if (!RECONCILIATION_STARTABLE_V2.has(child.workflowType)) return false;
  try {
    await startChild(child.workflowType, {
      workflowId: child.workflowId,
      workflowIdReusePolicy: child.reuse,
      taskQueue: scoutTaskQueues(stage).workflow,
      parentClosePolicy: "ABANDON",
      args: [child.input],
    });
    return true;
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
    throw error;
  }
}

/** Start every startable child one page found, adding to the run's totals. */
export async function startReconciliationChildrenV2(
  stage: ScoutStage,
  pending: ScoutReconciliationScanV2Result["pending"],
  totals: ScoutReconciliationChildCountsV2,
): Promise<void> {
  for (const family of RECONCILIATION_CHILD_FAMILIES_V2) {
    for (const child of childrenOfFamily(stage, family, pending)) {
      if (await startReconciliationChildV2(stage, child)) {
        totals[family] += 1;
      }
    }
  }
}
