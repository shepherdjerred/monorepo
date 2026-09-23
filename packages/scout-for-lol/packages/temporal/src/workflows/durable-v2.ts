import {
  continueAsNew,
  isCancellation,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { ApplicationFailure } from "@temporalio/common";
import type { NotificationAttemptNonce } from "@scout-for-lol/domain/notifications/intent.ts";
import type { RecoveryBatchState } from "@scout-for-lol/domain/recovery/batch.ts";
import type {
  ScoutIntentSummaryV2,
  ScoutNotificationDeliveryV2Result,
  ScoutNotificationGateV2,
} from "#src/activity-contracts-v2.ts";
import type {
  ScoutIntentRefV2,
  ScoutRecoveryBatchRefV2,
} from "#src/contracts-v2.ts";
import type { ScoutRecoveryCountsReportV2 } from "#src/workflow-contracts-v2.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutLakeProjectionV2ResultCodec,
  scoutNotificationV2InputCodec,
  scoutNotificationV2ResultCodec,
  scoutPipelineReconciliationV2InputCodec,
  scoutPipelineReconciliationV2ResultCodec,
  scoutRecoveryBatchV2InputCodec,
  scoutRecoveryBatchV2ResultCodec,
  type ScoutLakeProjectionV2InputEnvelope,
  type ScoutLakeProjectionV2ResultEnvelope,
  type ScoutNotificationV2InputEnvelope,
  type ScoutNotificationV2ResultEnvelope,
  type ScoutPipelineReconciliationV2InputEnvelope,
  type ScoutPipelineReconciliationV2ResultEnvelope,
  type ScoutRecoveryBatchV2InputEnvelope,
  type ScoutRecoveryBatchV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { scoutNotificationAttemptNonce } from "#src/identifiers.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";
import {
  backgroundV2Activities,
  lakeV2Activities,
  notificationDeliveryV2Activities,
  realtimeV2Activities,
} from "./activity-options.ts";
import {
  emptyReconciliationChildCountsV2,
  startReconciliationChildrenV2,
} from "./durable-v2-children.ts";

/**
 * How many send attempts one notification run makes before it stops and leaves
 * the intent for the next sweep.
 *
 * A retryable failure returns the intent to `ready`, which is the domain
 * saying "try again" — so trying again here is what the machine is for, and
 * Discord latency is the product. The budget is small because the failures
 * that survive three attempts are not the transient kind, and because a run
 * that kept retrying would hold an execution open against an intent the
 * freshness deadline is about to suppress anyway.
 */
const NOTIFICATION_SEND_ATTEMPTS = 3;
const NOTIFICATION_RETRY_BACKOFF_MS = 5000;

/** Pages one recovery or reconciliation run does before Continue-As-New. */
const RECOVERY_PAGES_PER_RUN = 25;
const RECONCILIATION_PAGES_PER_RUN = 25;

/**
 * States the notification machine never leaves on its own.
 *
 * `unknown-delivery` is in this set and is NOT a failure. The request left,
 * the response did not arrive, and only an operator who looked can say whether
 * a message exists; the domain leaves that state through
 * `operatorResolveUnknown` alone, so a Workflow that treated it as retryable
 * would be the exact mechanism by which a user gets told the same thing twice.
 */
const NOTIFICATION_TERMINAL_STATES: ReadonlySet<string> = new Set([
  "delivered",
  "suppressed",
  "expired",
  "permission-denied",
  "unknown-delivery",
]);

function notificationResult(
  summary: ScoutIntentSummaryV2,
): ScoutNotificationV2ResultEnvelope {
  return scoutNotificationV2ResultCodec.serialize({
    status: "completed",
    intentKey: summary.intentKey,
    state: summary.state,
    attemptCount: summary.attemptCount,
    disposition: { kind: "driven" },
  });
}

/**
 * A run that stopped at the policy gate.
 *
 * `no-op` rather than `completed`, because nothing was done to the intent:
 * no render, no attempt, no transition. The disposition names the policy and
 * the target so the history says why, and the intent stays exactly where the
 * reconciliation sweep will find it once the batch is released — which is
 * the only thing that can change this answer.
 */
function heldResult(
  summary: ScoutIntentSummaryV2,
  gate: ScoutNotificationGateV2,
): ScoutNotificationV2ResultEnvelope {
  return scoutNotificationV2ResultCodec.serialize({
    status: "no-op",
    intentKey: summary.intentKey,
    state: summary.state,
    attemptCount: summary.attemptCount,
    disposition: { kind: "held", policy: gate.policy, target: gate.target },
  });
}

type NotificationActivities = ReturnType<typeof realtimeV2Activities>;

/**
 * Record an attempt whose outcome nobody observed, against the exact nonce
 * that produced it.
 *
 * Reached from two directions. A fresh execution that opens on `sending` found
 * an attempt some earlier execution began and never finished — the Workflow ID
 * is derived from the intent key, so two executions cannot overlap, and an
 * execution that closed mid-send left an outcome nothing will ever report. And
 * a send whose Activity threw rather than answered is ambiguous in exactly the
 * same way: `deliverNotificationV2` runs with `maximumAttempts: 1` precisely so
 * an ambiguous send terminates as ONE attempt instead of being retried into a
 * possible duplicate.
 *
 * Both cases resolve identically, and neither re-sends.
 */
async function recordUnobservedSend(
  activities: NotificationActivities,
  ref: ScoutIntentRefV2,
  attemptNonce: NotificationAttemptNonce,
): Promise<ScoutIntentSummaryV2> {
  setWorkflowPhase("**Phase:** recording an unobserved send attempt");
  const recorded = await activities.recordNotificationOutcomeV2({
    ...ref,
    attemptNonce,
    delivery: { outcome: "unknown" },
  });
  return {
    intentKey: ref.intentKey,
    state: recorded.state,
    attemptCount: recorded.attemptCount,
  };
}

/**
 * One send attempt: mint a nonce, commit it, deliver, record what happened.
 *
 * Three Activities rather than one, and the split is the whole point. The
 * nonce is committed BEFORE the Discord call and the outcome AFTER it, so a
 * worker that dies mid-send leaves an attempt that is identifiable rather than
 * a gap — which is what lets the next run resolve it as `unknown-delivery`
 * against that exact attempt instead of guessing.
 *
 * `beginNotificationSendV2` can answer with something other than `sending`:
 * the freshness deadline may have passed, or another writer may have moved the
 * intent. That is an answer, not a fault, and the caller stops on it.
 */
async function attemptNotificationSend(
  activities: NotificationActivities,
  ref: ScoutIntentRefV2,
  attempt: number,
): Promise<ScoutIntentSummaryV2> {
  const attemptNonce = scoutNotificationAttemptNonce(
    workflowInfo().runId,
    attempt,
  );
  setWorkflowPhase(
    `**Phase:** committing send attempt ${String(attempt)} under its nonce`,
  );
  const begun = await activities.beginNotificationSendV2({
    ...ref,
    attemptNonce,
  });
  if (begun.state.kind !== "sending") {
    return {
      intentKey: ref.intentKey,
      state: begun.state,
      attemptCount: begun.attemptCount,
    };
  }

  setWorkflowPhase("**Phase:** delivering the notification");
  let delivery: ScoutNotificationDeliveryV2Result;
  try {
    delivery = await notificationDeliveryV2Activities(
      ref.stage,
    ).deliverNotificationV2({ ...ref, attemptNonce });
  } catch (error) {
    // A cancellation is the caller's decision and must reach it.
    //
    // Everything else reaching this catch is genuinely ambiguous, and that is
    // an invariant the Activity maintains rather than a guess made here.
    // `deliverNotificationV2` decides every failure it can see: anything that
    // went wrong BEFORE a request could have left comes back as a `failed`
    // result, retryable or terminal, because it definitely did not send. Only
    // a failure the Activity could not answer at all — a worker that died, a
    // timeout that fired mid-call — arrives as a throw, and for those the
    // request may have reached Discord before the failure. So the honest
    // record is the unobserved one, against this attempt's own nonce.
    if (isCancellation(error)) throw error;
    return await recordUnobservedSend(activities, ref, attemptNonce);
  }

  setWorkflowPhase("**Phase:** recording the delivery outcome");
  const recorded = await activities.recordNotificationOutcomeV2({
    ...ref,
    attemptNonce,
    delivery,
  });
  if (delivery.outcome === "delivered") {
    await runPostDeliveryFollowUp(activities, ref, attemptNonce);
  }
  return {
    intentKey: ref.intentKey,
    state: recorded.state,
    attemptCount: recorded.attemptCount,
  };
}

/**
 * The best-effort step that follows a delivered send — today, the Dare callout
 * refresh — in its own Activity and strictly after the outcome above is
 * durably recorded.
 *
 * It used to run at the tail of `deliverNotificationV2`, where a refresh that
 * outlived the delivery Activity's heartbeat timeout killed the Activity
 * before its already-decided `delivered` result could be returned, and the
 * catch above recorded a message Discord had accepted as an ambiguous send.
 * Out here the outcome is already written, so the worst a failure costs is the
 * refresh itself — which is what "best-effort" was always supposed to mean.
 */
async function runPostDeliveryFollowUp(
  activities: NotificationActivities,
  ref: ScoutIntentRefV2,
  attemptNonce: NotificationAttemptNonce,
): Promise<void> {
  setWorkflowPhase("**Phase:** running the post-delivery follow-up");
  try {
    await activities.afterNotificationDeliveredV2({ ...ref, attemptNonce });
  } catch (error) {
    // A cancellation is still the caller's decision. Anything else is a
    // follow-up that did not happen after a delivery that did, and failing the
    // run over it would misreport a notification the user received.
    if (isCancellation(error)) throw error;
  }
}

/**
 * One notification intent, V2.
 *
 * Drives the domain intent machine over the durable intent row: ready it,
 * render what it will deliver, then send under a freshly minted attempt nonce
 * and record the outcome. Every state the machine can be in is a stopping
 * point or a step, and the Workflow never invents a transition the domain does
 * not offer — `suppressStale` and `operatorResolveUnknown` have no Activity
 * here on purpose, because both belong to somebody other than this run.
 *
 * The render is one call before the send loop rather than one per attempt: it
 * reuses committed output, so a repeat would be a no-op that still costs a
 * background round trip on the retry path.
 *
 * ## The policy gate
 *
 * The opening read also answers whether the intent's recovery policy permits
 * its target (`gate`). A held intent is left untouched — not readied, not
 * rendered, no attempt minted — and the run reports `held`. The same
 * decision is re-made by `beginNotificationSendV2` against the batch row
 * before any nonce is committed, so a Workflow that skipped this check could
 * still not send; this early exit exists so a held intent costs no render
 * and no history beyond the read.
 */
export async function scoutNotificationV2Workflow(
  rawInput: ScoutNotificationV2InputEnvelope,
): Promise<ScoutNotificationV2ResultEnvelope> {
  const input = scoutNotificationV2InputCodec.parse(rawInput);
  const ref = { stage: input.stage, intentKey: input.intentKey };
  const activities = realtimeV2Activities(input.stage);

  setWorkflowPhase("**Phase:** reading the notification intent");
  const opening = await activities.readNotificationIntentV2(ref);
  if (opening.kind === "absent") {
    // A child was started for an intent nothing minted. Retrying cannot make
    // the row appear, and inventing one would mint a decision to notify that
    // no producer made.
    throw ApplicationFailure.nonRetryable(
      `Notification intent ${input.intentKey} does not exist`,
      "MissingDomainRecord",
    );
  }
  let summary = opening.intent;

  if (
    opening.gate.decision === "held" &&
    !NOTIFICATION_TERMINAL_STATES.has(summary.state.kind) &&
    summary.state.kind !== "sending"
  ) {
    // Settled and in-flight intents are reported and resolved as they always
    // were: a hold governs whether a NEW send may begin, never what happened
    // to one that already did.
    return heldResult(summary, opening.gate);
  }

  if (summary.state.kind === "sending") {
    return notificationResult(
      await recordUnobservedSend(activities, ref, summary.state.attemptNonce),
    );
  }
  if (NOTIFICATION_TERMINAL_STATES.has(summary.state.kind)) {
    return notificationResult(summary);
  }

  if (summary.state.kind === "pending") {
    setWorkflowPhase("**Phase:** marking the intent ready");
    const ready = await activities.markNotificationReadyV2(ref);
    summary = {
      ...summary,
      state: ready.state,
      attemptCount: ready.attemptCount,
    };
  }
  if (summary.state.kind !== "ready") return notificationResult(summary);

  setWorkflowPhase("**Phase:** rendering the notification artifact");
  await backgroundV2Activities(input.stage).renderNotificationArtifactV2(ref);

  for (let attempt = 1; attempt <= NOTIFICATION_SEND_ATTEMPTS; attempt += 1) {
    summary = await attemptNotificationSend(activities, ref, attempt);
    // Anything but `ready` is the machine having said its piece: delivered,
    // permission-denied, unknown-delivery, or a conflict that moved the intent
    // somewhere this run has no business driving it out of.
    if (summary.state.kind !== "ready") break;
    if (attempt < NOTIFICATION_SEND_ATTEMPTS) {
      setWorkflowPhase("**Phase:** waiting out a retryable send failure");
      await sleep(NOTIFICATION_RETRY_BACKOFF_MS * attempt);
    }
  }
  return notificationResult(summary);
}

/**
 * Lake projection for one match, V2.
 *
 * Receipted staging on the lake queue. The projection is derived and
 * rebuildable — S3 holds the canonical bytes — so its receipt attests to the
 * source object and digest the rows came from rather than to the staging files
 * themselves, which live on one role's own volume and mean nothing elsewhere.
 *
 * There is no phase gate and no resume read, because there is nothing to
 * resume past: staging overwrites whole files under keys derived from the
 * match, so a repeat writes the same bytes. Strict semantics come from the
 * receipted door itself — a staging write that did not happen throws and
 * records no receipt, so the Activity fails and retries rather than reporting
 * a projection nothing can corroborate.
 */
export async function scoutLakeProjectionV2Workflow(
  rawInput: ScoutLakeProjectionV2InputEnvelope,
): Promise<ScoutLakeProjectionV2ResultEnvelope> {
  const input = scoutLakeProjectionV2InputCodec.parse(rawInput);
  setWorkflowPhase(
    `**Phase:** staging the lake projection for \`${input.riotMatchId}\``,
  );
  const staged = await lakeV2Activities(input.stage).stageLakeProjectionV2({
    stage: input.stage,
    riotMatchId: input.riotMatchId,
  });
  return scoutLakeProjectionV2ResultCodec.serialize({
    status: "completed",
    riotMatchId: input.riotMatchId,
    receiptKinds: staged.receipts.map((receipt) => receipt.kind),
    stagedFileCount: staged.stagedFileCount,
  });
}

type RecoveryActivities = ReturnType<typeof backgroundV2Activities>;

/** A recovery batch is finished when nothing can drive it any further. */
function recoveryClosed(state: RecoveryBatchState): boolean {
  return state.kind === "complete" || state.kind === "abandoned";
}

/**
 * What THIS run can say about the batch's tally.
 *
 * The durable row holds count columns only while the batch is `processing`,
 * so a run that a sweep or an operator started onto a batch already past that
 * state never saw a tally and no read can recover one. `unobserved` is that
 * said out loud. The alternative is to report zeros the run invented, which is
 * the one answer an operator cannot tell apart from a batch that genuinely
 * found nothing.
 */
function recoveryCounts(
  state: RecoveryBatchState,
  observed: RecoveryBatchState | null,
): ScoutRecoveryCountsReportV2 {
  if (state.kind === "processing") {
    return { kind: "observed", counts: state.counts };
  }
  return observed?.kind === "processing"
    ? { kind: "observed", counts: observed.counts }
    : { kind: "unobserved" };
}

/**
 * How much of each phase this run has seen through to its end.
 *
 * The batch state alone cannot answer "is the scan finished", because the
 * domain has no `scanned` state — `beginProcessing` is what leaves `scanning`,
 * and `beginDigest` is what leaves `processing`. Both live inside the
 * Activities, so the only place that knows a phase is exhausted is the page
 * result that said so, and that has to be carried between iterations.
 */
type RecoveryPhaseProgress = { scan: boolean; process: boolean };

/**
 * Advance a batch by one unit of work, whichever phase it is in.
 *
 * The scan, process and digest Activities own their own transitions — each
 * returns the state it left the batch in — so this decides only which one is
 * next. A phase that reported itself complete is not re-entered: processing a
 * page after the tally is already whole would loop forever against a
 * `recordProcessingProgress` that correctly answers `already-applied`.
 */
async function advanceRecoveryBatch(
  activities: RecoveryActivities,
  ref: ScoutRecoveryBatchRefV2,
  state: RecoveryBatchState,
  progress: RecoveryPhaseProgress,
): Promise<{ state: RecoveryBatchState; progress: RecoveryPhaseProgress }> {
  if (
    state.kind === "planned" ||
    (state.kind === "scanning" && !progress.scan)
  ) {
    setWorkflowPhase("**Phase:** scanning the next recovery page");
    const scan = await activities.scanRecoveryPageV2(ref);
    return {
      state: scan.state,
      progress: { scan: scan.complete, process: false },
    };
  }
  if (
    (state.kind === "scanning" || state.kind === "processing") &&
    !progress.process
  ) {
    setWorkflowPhase("**Phase:** processing the next recovery page");
    const processed = await activities.processRecoveryPageV2(ref);
    return {
      state: processed.state,
      progress: { scan: true, process: processed.complete },
    };
  }
  setWorkflowPhase("**Phase:** digesting the recovery batch");
  const digested = await activities.digestRecoveryBatchV2(ref);
  return { state: digested.state, progress };
}

/**
 * One recovery batch, V2.
 *
 * Scans a bounded number of pages, processes what it found, digests the
 * outcome for an operator, and closes — continuing as new before the history
 * grows, guided by `continueAsNewSuggested` and this run's own page budget.
 *
 * The input carries no cursor, and that is deliberate: the scan position, the
 * page budget and the counts live in the durable batch row, so a
 * Continue-As-New that re-serialized them would give the batch two sources of
 * truth that a crash between the cursor write and the Continue-As-New could
 * disagree about. Re-reading the row on every run is what makes a resumed
 * batch and a fresh one the same code path.
 *
 * ## What a V2 recovery batch repairs, and what it does not
 *
 * It repairs DURABLE gaps: a match whose raw payload reached the object store
 * and whose `MatchObservation` never landed — exactly what a crash between the
 * object write and the domain commit leaves behind. Each one gets an
 * `ARCHIVE_ONLY` observation, capturing the fact without running a single
 * downstream effect.
 *
 * It does NOT do outage backfill. A match Riot was never polled for during a
 * downtime is a FETCH gap, and nothing in the durable tables knows it exists —
 * there is no receipt to scan and therefore nothing for this batch to find.
 * Fetch gaps remain v1 polling's recovery job, through its `recoveryStartAt`
 * windows, until a later wave moves them. "Recovery batch" names one of those
 * two jobs, not both.
 *
 * Promotion is likewise somebody else's. `ARCHIVE_ONLY` promotes to `FULL` at
 * most once, and the live pipeline is what promotes it when the match is
 * processed for real; a batch that promoted its own observations would trigger
 * the downstream effects it exists to avoid.
 */
export async function scoutRecoveryBatchV2Workflow(
  rawInput: ScoutRecoveryBatchV2InputEnvelope,
): Promise<ScoutRecoveryBatchV2ResultEnvelope> {
  const input = scoutRecoveryBatchV2InputCodec.parse(rawInput);
  const activities = backgroundV2Activities(input.stage);
  const ref = {
    stage: input.stage,
    recoveryBatchId: input.recoveryBatchId,
  };

  setWorkflowPhase("**Phase:** reading the recovery batch");
  const opening = await activities.readRecoveryBatchV2(ref);
  if (opening.kind === "absent") {
    throw ApplicationFailure.nonRetryable(
      `Recovery batch ${input.recoveryBatchId} does not exist`,
      "MissingDomainRecord",
    );
  }

  let state = opening.state;
  // The tally this run actually watched, as opposed to the one it inherited.
  // A batch leaves `processing` by having its count columns written to NULL,
  // so the last processing state this run SAW is the only place the numbers
  // survive once the digest transition lands.
  let observedProcessing: RecoveryBatchState | null =
    state.kind === "processing" ? state : null;
  let progress: RecoveryPhaseProgress = { scan: false, process: false };

  for (let page = 0; page < RECOVERY_PAGES_PER_RUN; page += 1) {
    if (recoveryClosed(state)) break;
    if (state.kind === "digesting") {
      setWorkflowPhase("**Phase:** closing the recovery batch");
      const closed = await activities.closeRecoveryBatchV2({
        ...ref,
        close: { outcome: "complete" },
      });
      state = closed.state;
      break;
    }
    const advanced = await advanceRecoveryBatch(
      activities,
      ref,
      state,
      progress,
    );
    state = advanced.state;
    progress = advanced.progress;
    if (state.kind === "processing") observedProcessing = state;
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof scoutRecoveryBatchV2Workflow>(rawInput);
    }
  }

  if (!recoveryClosed(state)) {
    // The page budget ran out with work left. Continuing as new is the whole
    // reason the row owns the cursor: the next run reads exactly where this
    // one stopped, with a history that starts empty.
    await continueAsNew<typeof scoutRecoveryBatchV2Workflow>(rawInput);
  }

  return scoutRecoveryBatchV2ResultCodec.serialize({
    status: "completed",
    recoveryBatchId: input.recoveryBatchId,
    state,
    counts: recoveryCounts(state, observedProcessing),
  });
}

/**
 * Pipeline reconciliation, V2.
 *
 * Bounded scans for work nothing is currently driving — matches observed but
 * never processed, intents stalled short of delivery, matches whose lake
 * projection never staged, recovery batches left without a driver — starting
 * the owning Workflow for each. Every child ID is derived from the work
 * itself, so restarting one that is already running is a no-op rather than a
 * duplicate.
 *
 * Like recovery it carries no cursor across Continue-As-New: the scan is
 * idempotent and resumes from the durable watermark each run, so repeating the
 * input unchanged is correct rather than lossy.
 *
 * ## The v1 seam
 *
 * The v1 `progression-outbox` Schedule runs two unrelated jobs a minute:
 * `reconcileCompetitiveProgression`, which re-adopts Temporal starts whose
 * initial launch was interrupted, and the hall and duel outbox DRAINS. This
 * Workflow is the V2 equivalent of the first role only. Outbox draining stays
 * on v1 — the hall and duel outboxes have not been migrated to durable intents
 * yet, and draining them from here would deliver through a path with no intent
 * row behind it. The v1 Schedule is deliberately untouched by this change;
 * moving it belongs to the rollout, not to the lane that implements the body.
 */
export async function scoutPipelineReconciliationV2Workflow(
  rawInput: ScoutPipelineReconciliationV2InputEnvelope,
): Promise<ScoutPipelineReconciliationV2ResultEnvelope> {
  const input = scoutPipelineReconciliationV2InputCodec.parse(rawInput);
  const activities = backgroundV2Activities(input.stage);
  const childrenStarted = emptyReconciliationChildCountsV2();
  let pagesScanned = 0;

  for (let page = 0; page < RECONCILIATION_PAGES_PER_RUN; page += 1) {
    setWorkflowPhase(
      `**Phase:** scanning reconciliation page ${String(page + 1)}`,
    );
    const scan = await activities.scanPipelineReconciliationPageV2(input);
    pagesScanned += 1;
    await startReconciliationChildrenV2(
      input.stage,
      scan.pending,
      childrenStarted,
    );
    if (scan.complete) {
      return scoutPipelineReconciliationV2ResultCodec.serialize({
        status: "completed",
        trigger: input.trigger,
        pagesScanned,
        childrenStarted,
      });
    }
    if (workflowInfo().continueAsNewSuggested) break;
  }

  // Work remains. The sweep is idempotent and the children are abandoned, so a
  // fresh history picks up exactly where this one left off without carrying
  // anything but the input it was given.
  return await continueAsNew<typeof scoutPipelineReconciliationV2Workflow>(
    rawInput,
  );
}
