import type {
  ScoutLakeProjectionV2InputEnvelope,
  ScoutLakeProjectionV2ResultEnvelope,
  ScoutNotificationV2InputEnvelope,
  ScoutNotificationV2ResultEnvelope,
  ScoutPipelineReconciliationV2InputEnvelope,
  ScoutPipelineReconciliationV2ResultEnvelope,
  ScoutRecoveryBatchV2InputEnvelope,
  ScoutRecoveryBatchV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { SCOUT_WORKFLOW_NAMES } from "#src/identifiers.ts";
import { unimplementedV2Workflow } from "./unimplemented-v2.ts";

/**
 * One notification intent, V2.
 *
 * Drives the domain intent machine: ready, render, begin the send under a
 * freshly minted attempt nonce, deliver, and record the outcome.
 *
 * The send is deliberately three Activities rather than one. The nonce is
 * committed BEFORE the Discord call and the outcome AFTER it, so a worker that
 * dies mid-send leaves an attempt that is identifiable rather than a gap.
 * `deliverNotificationV2` runs with `maximumAttempts: 1`; an ambiguous send
 * becomes `unknown-delivery` against that nonce and stops there. That state is
 * terminal for the Workflow by design — only an operator who looked can say
 * whether a message exists, and an automatic retry would risk telling a user
 * the same thing twice.
 */
export function scoutNotificationV2Workflow(
  input: ScoutNotificationV2InputEnvelope,
): Promise<ScoutNotificationV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.notificationV2,
    input.kind,
  );
}

/**
 * Lake projection for one match, V2.
 *
 * Receipted staging on the lake queue. The projection is derived and
 * rebuildable — S3 holds the canonical bytes — so its receipt attests to the
 * source object and digest the rows came from rather than to the staging files
 * themselves, which live on one role's own volume and mean nothing elsewhere.
 */
export function scoutLakeProjectionV2Workflow(
  input: ScoutLakeProjectionV2InputEnvelope,
): Promise<ScoutLakeProjectionV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
    input.kind,
  );
}

/**
 * One recovery batch, V2.
 *
 * Scans a bounded number of pages, processes what it found, digests the
 * outcome for an operator, and closes — continuing as new before the history
 * grows, guided by `continueAsNewSuggested` and the batch's own page budget.
 *
 * The input carries no cursor. The scan position, budget and counts live in
 * the durable batch row, so a Continue-As-New that re-serialized them would
 * create a second source of truth that a crash between the cursor write and
 * the Continue-As-New could disagree with.
 */
export function scoutRecoveryBatchV2Workflow(
  input: ScoutRecoveryBatchV2InputEnvelope,
): Promise<ScoutRecoveryBatchV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
    input.kind,
  );
}

/**
 * Pipeline reconciliation, V2.
 *
 * Bounded scans for work nothing is currently driving — unprocessed matches,
 * stalled intents, unstaged projections, orphaned recovery batches — starting
 * the owning Workflow for each. Every child ID is derived from the work
 * itself, so restarting one that is already running is a no-op rather than a
 * duplicate.
 *
 * Like recovery, it carries no cursor across Continue-As-New: the scan is
 * idempotent and resumes from the durable watermark each run.
 */
export function scoutPipelineReconciliationV2Workflow(
  input: ScoutPipelineReconciliationV2InputEnvelope,
): Promise<ScoutPipelineReconciliationV2ResultEnvelope> {
  return unimplementedV2Workflow(
    SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
    input.kind,
  );
}
