import { ApplicationFailure } from "@temporalio/common";
import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type IsoInstant,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  NotificationAttemptNonce,
  NotificationIntent,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  confirmUnsentSuppression,
  markReady,
  recordFailure,
  recordUnknownDelivery,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type {
  RecoveryBatch,
  RecoveryBatchState,
  RecoveryCounts,
  RecoveryPolicy,
} from "@scout-for-lol/domain/recovery/batch.ts";
import { notificationDeliveryDecision } from "@scout-for-lol/domain/recovery/delivery-policy.ts";
import {
  beginDigest,
  beginProcessing,
  beginScan,
  completeBatch,
  recordProcessingProgress,
  type RecoveryTransitionResult,
} from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import type {
  ScoutLakeStagingResult,
  ScoutNotificationDeliveryResult,
  ScoutNotificationFollowUpResult,
  ScoutNotificationGate,
  ScoutNotificationIntentResult,
  ScoutNotificationOutcomeInput,
  ScoutNotificationRenderResult,
  ScoutNotificationTransitionResult,
  ScoutReconciliationScanResult,
  ScoutRecoveryBatchStateResult,
  ScoutRecoveryProcessResult,
  ScoutRecoveryScanResult,
  ScoutRecoveryTransitionResult,
} from "#src/activity-contracts.ts";
import type { ScoutIntentAttemptRef } from "#src/pipeline-contracts.ts";

/**
 * Doubles for the durable lane's Activities.
 *
 * The notification and recovery stubs run the REAL pure domain machines over an
 * in-memory row rather than scripting states. That is the point of these tests:
 * the Workflow's job is to drive a machine it does not own, and a fake machine
 * would let a Workflow that drives it wrongly still pass. What the fakes stand
 * in for is only the persistence and the outside world — Prisma, Riot, S3,
 * Discord — none of which the Workflow's decisions turn on.
 *
 * {@link ScoutNotificationStore.sends} is the assertion surface that matters
 * most: one entry per attempt that actually reached "Discord", by nonce. A test
 * that wants to say "this did not double-deliver" says it about that array.
 */

/**
 * A v1-shaped intent key: the same `postmatch-discord:{match}:{channel}` string
 * the effect claim uses, because the two were deliberately minted alike so an
 * intent can become the at-most-once guard without re-keying anything stored.
 */
export const INTENT_KEY = NotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_9101:100000000000000001",
);
export const LAKE_MATCH_ID: RiotMatchId = RiotMatchIdSchema.parse("NA1_9102");
export const RECOVERY_BATCH_ID = RecoveryBatchIdSchema.parse("recovery-9103");
const MESSAGE_ID = DiscordMessageIdSchema.parse("100000000000000777");

/**
 * The kind the receipted staging door records for a match projection. Spelled
 * here rather than imported because the Workflow package must not depend on the
 * backend, and the Workflow only ever passes the kind through to its result.
 */
export const LAKE_STAGING_MATCH_RECEIPT_KIND =
  ReceiptKindSchema.parse("lake-staging-match");

/** Brand a literal instant, so the fixtures read as dates rather than parses. */
export function instant(value: string): IsoInstant {
  return IsoInstantSchema.parse(value);
}

/** What a scripted send does when the Workflow reaches Discord. */
export type ScriptedDelivery =
  | ScoutNotificationDeliveryResult
  /** The Activity throws instead of answering: an unobserved send. */
  | { outcome: "throw" };

export type ScoutNotificationStore = {
  intent: NotificationIntent | null;
  /**
   * The policy the intent is delivered under, as the read-side Activity would
   * resolve it off the recovery batch row. `normal` is what a live intent
   * gets; a test that models a recovery-born intent sets the batch's policy.
   */
  policy: RecoveryPolicy;
  renders: number;
  /** One entry per attempt that reached Discord, named by its nonce. */
  sends: NotificationAttemptNonce[];
  /** Outcomes to serve, in order; the last one repeats once exhausted. */
  script: ScriptedDelivery[];
  calls: string[];
  /** The call this worker dies on, modelling a crash right after the last. */
  failAt: string | null;
  /**
   * How the post-delivery follow-up behaves. `throws` models the real hazard
   * it was moved out of the send for: a Discord edit that outlives its
   * Activity's timeout. Out here that must cost the refresh and nothing else.
   */
  followUp: "completes" | "throws";
};

export function pendingIntent(): NotificationIntent {
  return {
    key: INTENT_KEY,
    kind: "postmatch",
    origin: { kind: "live" },
    target: {
      kind: "channel",
      channelId: DiscordChannelIdSchema.parse("100000000000000001"),
    },
    // Far enough out that `beginSend`'s freshness guard never fires by
    // accident; the tests that care about staleness set it themselves.
    freshnessDeadline: instant("2099-01-01T00:00:00.000Z"),
    createdAt: instant("2020-01-01T00:00:00.000Z"),
    attemptCount: 0,
    state: { kind: "pending" },
  };
}

export function createNotificationStore(
  overrides: Partial<ScoutNotificationStore> = {},
): ScoutNotificationStore {
  return {
    intent: pendingIntent(),
    policy: "normal",
    renders: 0,
    sends: [],
    script: [{ outcome: "delivered", messageId: MESSAGE_ID }],
    calls: [],
    failAt: null,
    followUp: "completes",
    ...overrides,
  };
}

/** The same intent, parked in a state some earlier run left it in. */
export function intentInState(
  state: NotificationIntent["state"],
  attemptCount = 0,
): NotificationIntent {
  return { ...pendingIntent(), attemptCount, state };
}

function requireIntent(store: ScoutNotificationStore): NotificationIntent {
  if (store.intent === null) {
    throw ApplicationFailure.nonRetryable("no intent", "MissingDomainRecord");
  }
  return store.intent;
}

/**
 * Apply one transition the way the repository does: the domain decides, and an
 * answer other than `applied` leaves the stored row exactly as it was.
 */
function applyIntentTransition(
  store: ScoutNotificationStore,
  result: NotificationTransitionResult,
): ScoutNotificationTransitionResult {
  if (result.outcome === "applied") store.intent = result.next;
  const stored = requireIntent(store);
  return {
    commit:
      result.outcome === "applied" ? { outcome: "applied" } : { ...result },
    state: stored.state,
    attemptCount: stored.attemptCount,
  };
}

/** The gate the real read Activity computes, from the store's policy. */
function gateFor(store: ScoutNotificationStore): ScoutNotificationGate {
  const intent = requireIntent(store);
  const target = intent.target.kind;
  return {
    kind: intent.kind,
    target,
    policy: store.policy,
    decision: notificationDeliveryDecision(store.policy, target),
  };
}

function nextScripted(store: ScoutNotificationStore): ScriptedDelivery {
  const head = store.script.length > 1 ? store.script.shift() : store.script[0];
  if (head === undefined) throw new Error("the delivery script ran dry");
  return head;
}

export function scoutNotificationStubs(store: ScoutNotificationStore) {
  const record = (call: string): void => {
    store.calls.push(call);
    if (call === store.failAt) {
      throw ApplicationFailure.nonRetryable(
        `injected crash at ${call}`,
        "InjectedCrash",
      );
    }
  };
  return {
    readNotificationIntent: (): ScoutNotificationIntentResult => {
      record("readNotificationIntent");
      if (store.intent === null) return { kind: "absent" };
      return {
        kind: "present",
        intent: {
          intentKey: store.intent.key,
          state: store.intent.state,
          attemptCount: store.intent.attemptCount,
          ...(store.intent.lastFailure === undefined
            ? {}
            : { lastFailure: store.intent.lastFailure }),
        },
        gate: gateFor(store),
      };
    },
    markNotificationReady: (): ScoutNotificationTransitionResult => {
      record("markNotificationReady");
      return applyIntentTransition(store, markReady(requireIntent(store)));
    },
    renderNotificationArtifact: (): ScoutNotificationRenderResult => {
      record("renderNotificationArtifact");
      const reused = store.renders > 0;
      store.renders += 1;
      return { outcome: reused ? "reused" : "rendered" };
    },
    beginNotificationSend: (
      input: ScoutIntentAttemptRef,
    ): ScoutNotificationTransitionResult => {
      record("beginNotificationSend");
      // The write boundary re-asks the gate, exactly as the real Activity
      // does against the batch row: a held intent gets no nonce.
      if (gateFor(store).decision === "held") {
        const held = requireIntent(store);
        return {
          commit: { outcome: "conflict", reason: "policy-held" },
          state: held.state,
          attemptCount: held.attemptCount,
        };
      }
      return applyIntentTransition(
        store,
        beginSend(requireIntent(store), {
          attemptNonce: input.attemptNonce,
          startedAt: instant("2024-01-01T00:00:00.000Z"),
        }),
      );
    },
    deliverNotification: (
      input: ScoutIntentAttemptRef,
    ): ScoutNotificationDeliveryResult => {
      record("deliverNotification");
      const scripted = nextScripted(store);
      // A suppressed outcome is a confirmed pre-send refusal. The other
      // scripted outcomes may have reached Discord, including a throw.
      if (scripted.outcome !== "suppressed") {
        store.sends.push(input.attemptNonce);
      }
      if (scripted.outcome === "throw") {
        throw ApplicationFailure.nonRetryable(
          "the send did not answer",
          "AmbiguousProviderAttempt",
        );
      }
      return scripted;
    },
    afterNotificationDelivered: (): ScoutNotificationFollowUpResult => {
      record("afterNotificationDelivered");
      if (store.followUp === "throws") {
        throw ApplicationFailure.nonRetryable(
          "the callout refresh never answered",
          "InjectedCrash",
        );
      }
      return { outcome: "completed" };
    },
    recordNotificationOutcome: (
      input: ScoutNotificationOutcomeInput,
    ): ScoutNotificationTransitionResult => {
      record("recordNotificationOutcome");
      const intent = requireIntent(store);
      const attemptNonce = input.attemptNonce;
      const delivery = input.delivery;
      if (delivery.outcome === "delivered") {
        return applyIntentTransition(
          store,
          confirmDelivered(intent, {
            attemptNonce,
            deliveredAt: instant("2024-01-01T00:01:00.000Z"),
            ...(delivery.messageId === undefined
              ? {}
              : { messageId: delivery.messageId }),
          }),
        );
      }
      if (delivery.outcome === "failed") {
        return applyIntentTransition(
          store,
          recordFailure(intent, { attemptNonce, failure: delivery.failure }),
        );
      }
      if (delivery.outcome === "suppressed") {
        return applyIntentTransition(
          store,
          confirmUnsentSuppression(intent, {
            attemptNonce,
            reason: delivery.reason,
          }),
        );
      }
      return applyIntentTransition(
        store,
        recordUnknownDelivery(intent, {
          attemptNonce,
          observedAt: instant("2024-01-01T00:01:00.000Z"),
        }),
      );
    },
  };
}

// ─── Lake ──────────────────────────────────────────────────────────────────

export type ScoutLakeStore = {
  stagedFileCount: number;
  calls: string[];
  /** Attempts that throw before one succeeds, modelling a strict door. */
  failuresBeforeSuccess: number;
};

export function createLakeStore(
  overrides: Partial<ScoutLakeStore> = {},
): ScoutLakeStore {
  return {
    stagedFileCount: 3,
    calls: [],
    failuresBeforeSuccess: 0,
    ...overrides,
  };
}

export function scoutLakeStubs(store: ScoutLakeStore) {
  return {
    stageLakeProjection: (): ScoutLakeStagingResult => {
      store.calls.push("stageLakeProjection");
      if (store.failuresBeforeSuccess > 0) {
        store.failuresBeforeSuccess -= 1;
        // The receipted door's own semantics: a staging write that did not
        // happen throws and records nothing, so there is no receipt to report.
        throw new Error("staging did not happen");
      }
      return {
        receipts: [
          {
            kind: LAKE_STAGING_MATCH_RECEIPT_KIND,
            commit: { outcome: "applied" },
          },
        ],
        stagedFileCount: store.stagedFileCount,
      };
    },
  };
}

// ─── Recovery ──────────────────────────────────────────────────────────────

export type ScoutRecoveryStore = {
  batch: RecoveryBatch | null;
  /** Items still to discover, then to process. */
  remaining: number;
  discovered: number;
  pageSize: number;
  calls: string[];
};

export function plannedBatch(): RecoveryBatch {
  return {
    id: RECOVERY_BATCH_ID,
    policy: "normal",
    createdAt: instant("2024-01-01T00:00:00.000Z"),
    state: { kind: "planned" },
  };
}

export function createRecoveryStore(
  overrides: Partial<ScoutRecoveryStore> = {},
): ScoutRecoveryStore {
  return {
    batch: plannedBatch(),
    remaining: 6,
    discovered: 6,
    pageSize: 2,
    calls: [],
    ...overrides,
  };
}

/** The same batch, parked in a state some earlier run left it in. */
export function batchInState(state: RecoveryBatchState): RecoveryBatch {
  return { ...plannedBatch(), state };
}

function requireBatch(store: ScoutRecoveryStore): RecoveryBatch {
  if (store.batch === null) {
    throw ApplicationFailure.nonRetryable("no batch", "MissingDomainRecord");
  }
  return store.batch;
}

function applyBatchTransition(
  store: ScoutRecoveryStore,
  result: RecoveryTransitionResult,
): ScoutRecoveryTransitionResult {
  if (result.outcome === "applied") store.batch = result.next;
  return {
    commit:
      result.outcome === "applied" ? { outcome: "applied" } : { ...result },
    state: requireBatch(store).state,
  };
}

function countsOf(state: RecoveryBatchState): RecoveryCounts {
  return state.kind === "processing"
    ? state.counts
    : { discovered: 0, succeeded: 0, suppressed: 0, failed: 0 };
}

export function scoutRecoveryStubs(store: ScoutRecoveryStore) {
  return {
    readRecoveryBatch: (): ScoutRecoveryBatchStateResult => {
      store.calls.push("readRecoveryBatch");
      if (store.batch === null) return { kind: "absent" };
      return {
        kind: "present",
        policy: store.batch.policy,
        state: store.batch.state,
      };
    },
    scanRecoveryPage: (): ScoutRecoveryScanResult => {
      store.calls.push("scanRecoveryPage");
      const batch = requireBatch(store);
      const opened =
        batch.state.kind === "planned"
          ? applyBatchTransition(store, beginScan(batch, { pageBudget: 8 }))
          : null;
      const scanning = requireBatch(store).state;
      const page = Math.min(store.pageSize, store.remaining);
      store.remaining -= page;
      return {
        commit: opened?.commit ?? { outcome: "already-applied" },
        state: scanning,
        discovered: page,
        complete: store.remaining === 0,
      };
    },
    processRecoveryPage: (): ScoutRecoveryProcessResult => {
      store.calls.push("processRecoveryPage");
      const batch = requireBatch(store);
      if (batch.state.kind === "scanning") {
        applyBatchTransition(
          store,
          beginProcessing(batch, { discovered: store.discovered }),
        );
      }
      const current = countsOf(requireBatch(store).state);
      const done = current.succeeded + current.suppressed + current.failed;
      const page = Math.min(store.pageSize, current.discovered - done);
      const next: RecoveryCounts = {
        ...current,
        succeeded: current.succeeded + page,
      };
      const applied = applyBatchTransition(
        store,
        recordProcessingProgress(requireBatch(store), { counts: next }),
      );
      const counts = countsOf(requireBatch(store).state);
      return {
        commit: applied.commit,
        state: requireBatch(store).state,
        counts,
        complete:
          counts.succeeded + counts.suppressed + counts.failed ===
          counts.discovered,
      };
    },
    digestRecoveryBatch: (): ScoutRecoveryTransitionResult => {
      store.calls.push("digestRecoveryBatch");
      return applyBatchTransition(store, beginDigest(requireBatch(store)));
    },
    closeRecoveryBatch: (): ScoutRecoveryTransitionResult => {
      store.calls.push("closeRecoveryBatch");
      return applyBatchTransition(store, completeBatch(requireBatch(store)));
    },
  };
}

// ─── Reconciliation ────────────────────────────────────────────────────────

export type ScoutReconciliationStore = {
  /** One entry per page the scan will serve, in order. */
  pages: ScoutReconciliationScanResult["pending"][];
  scanned: number;
  triggers: string[];
};

export function emptyPending(): ScoutReconciliationScanResult["pending"] {
  return {
    matchProcessing: [],
    notifications: [],
    lakeProjections: [],
    recoveryBatches: [],
  };
}

export function createReconciliationStore(
  overrides: Partial<ScoutReconciliationStore> = {},
): ScoutReconciliationStore {
  return { pages: [emptyPending()], scanned: 0, triggers: [], ...overrides };
}

export function scoutReconciliationStubs(store: ScoutReconciliationStore) {
  return {
    scanPipelineReconciliationPage: (input: {
      trigger: string;
    }): ScoutReconciliationScanResult => {
      store.triggers.push(input.trigger);
      const pending = store.pages[store.scanned] ?? emptyPending();
      store.scanned += 1;
      return { complete: store.scanned >= store.pages.length, pending };
    },
  };
}
