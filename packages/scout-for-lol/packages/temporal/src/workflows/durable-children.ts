import { startChild } from "@temporalio/workflow";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import type { ScoutStage } from "#src/contracts.ts";
import type { ScoutReconciliationScanResult } from "#src/activity-contracts.ts";
import {
  SCOUT_REUSE_POLICIES,
  SCOUT_WORKFLOW_NAMES,
  type ScoutRenamedWorkflowName,
  type ScoutReusePolicy,
  scoutLakeProjectionWorkflowId,
  scoutMatchProcessingWorkflowId,
  scoutNotificationWorkflowId,
  scoutRecoveryBatchWorkflowId,
  scoutTaskQueues,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionInputCodec,
  scoutMatchProcessingInputCodec,
  scoutNotificationInputCodec,
  scoutRecoveryBatchInputCodec,
} from "#src/workflow-contracts.ts";
import { IMPLEMENTED_FAN_OUT_WORKFLOWS } from "./match-fan-out.ts";
import { issuedWorkflowType } from "./generation-rename.ts";

/**
 * Turning one reconciliation page into child starts.
 *
 * This lives beside `durable.ts` rather than inside it because the four
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

export const RECONCILIATION_CHILD_FAMILIES = [
  "matchProcessing",
  "notifications",
  "lakeProjections",
  "recoveryBatches",
] as const;
export type ScoutReconciliationChildFamily =
  (typeof RECONCILIATION_CHILD_FAMILIES)[number];

export type ScoutReconciliationChildCounts = Record<
  ScoutReconciliationChildFamily,
  number
>;

export function emptyReconciliationChildCounts(): ScoutReconciliationChildCounts {
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
 * `unimplementedWorkflow` stub would not defer the work, it would destroy
 * it: the stub fails NON-RETRYABLY, and every ID below is derived from the
 * work itself, so the failed execution would own the ID that every later sweep
 * computes for the same work.
 *
 * DERIVED from `IMPLEMENTED_FAN_OUT_WORKFLOWS` rather than restating it, so
 * the two start sites cannot drift. That list answers a narrower question —
 * which of the two children a MATCH fans out to has a body — and is typed by
 * `ScoutMatchFanOutChild["workflowType"]` accordingly, so it could never
 * name the other two types this sweep starts. Spreading it and adding those
 * two keeps one source of truth for the overlap: a lane that lands a
 * notification or lake body edits the allowlist, and the sweep follows without
 * anyone remembering to edit a second list.
 *
 * Match processing and recovery batches are named here because nothing fans
 * out to them; the sweep is their only automated starter.
 */
const RECONCILIATION_STARTABLE: ReadonlySet<ScoutRenamedWorkflowName> =
  new Set<ScoutRenamedWorkflowName>([
    ...IMPLEMENTED_FAN_OUT_WORKFLOWS,
    SCOUT_WORKFLOW_NAMES.matchProcessing,
    SCOUT_WORKFLOW_NAMES.recoveryBatch,
  ]);

/**
 * Why a family reuses IDs the way it does is answered by
 * `SCOUT_REUSE_POLICIES` in `identifiers.ts`, which carries the reasoning.
 * The sweep reads that table rather than restating its values, because the
 * operations API's operator starts re-drive the same families from the backend
 * and the two starters must never disagree about the terms of a start.
 */
type ReconciliationChild = {
  readonly workflowType: ScoutRenamedWorkflowName;
  readonly workflowId: string;
  readonly input: unknown;
  readonly reuse: ScoutReusePolicy;
};

function childrenOfFamily(
  stage: ScoutStage,
  family: ScoutReconciliationChildFamily,
  pending: ScoutReconciliationScanResult["pending"],
): readonly ReconciliationChild[] {
  switch (family) {
    case "matchProcessing":
      return pending.matchProcessing.map((riotMatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.matchProcessing,
        workflowId: scoutMatchProcessingWorkflowId(stage, riotMatchId),
        input: scoutMatchProcessingInputCodec.serialize({
          stage,
          riotMatchId,
        }),
        reuse: SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.matchProcessing],
      }));
    case "notifications":
      return pending.notifications.map((intentKey) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.notification,
        workflowId: scoutNotificationWorkflowId(stage, intentKey),
        input: scoutNotificationInputCodec.serialize({ stage, intentKey }),
        reuse: SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.notification],
      }));
    case "lakeProjections":
      return pending.lakeProjections.map((riotMatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.lakeProjection,
        workflowId: scoutLakeProjectionWorkflowId(stage, riotMatchId),
        input: scoutLakeProjectionInputCodec.serialize({
          stage,
          riotMatchId,
        }),
        reuse: SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.lakeProjection],
      }));
    case "recoveryBatches":
      return pending.recoveryBatches.map((recoveryBatchId) => ({
        workflowType: SCOUT_WORKFLOW_NAMES.recoveryBatch,
        workflowId: scoutRecoveryBatchWorkflowId(stage, recoveryBatchId),
        input: scoutRecoveryBatchInputCodec.serialize({
          stage,
          recoveryBatchId,
        }),
        reuse: SCOUT_REUSE_POLICIES[SCOUT_WORKFLOW_NAMES.recoveryBatch],
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
async function startReconciliationChild(
  stage: ScoutStage,
  child: ReconciliationChild,
): Promise<boolean> {
  if (!RECONCILIATION_STARTABLE.has(child.workflowType)) return false;
  try {
    await startChild(issuedWorkflowType(child.workflowType), {
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
export async function startReconciliationChildren(
  stage: ScoutStage,
  pending: ScoutReconciliationScanResult["pending"],
  totals: ScoutReconciliationChildCounts,
): Promise<void> {
  for (const family of RECONCILIATION_CHILD_FAMILIES) {
    for (const child of childrenOfFamily(stage, family, pending)) {
      if (await startReconciliationChild(stage, child)) {
        totals[family] += 1;
      }
    }
  }
}
