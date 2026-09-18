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
  ScoutLakeStagingV2Result,
  ScoutNotificationDeliveryV2Result,
  ScoutNotificationGateV2,
  ScoutNotificationIntentV2Result,
  ScoutNotificationOutcomeV2Input,
  ScoutNotificationRenderV2Result,
  ScoutNotificationTransitionV2Result,
  ScoutReconciliationScanV2Result,
  ScoutRecoveryBatchStateV2Result,
  ScoutRecoveryProcessV2Result,
  ScoutRecoveryScanV2Result,
  ScoutRecoveryTransitionV2Result,
} from "#src/activity-contracts-v2.ts";
import type { ScoutIntentAttemptRefV2 } from "#src/contracts-v2.ts";

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
 * {@link ScoutV2NotificationStore.sends} is the assertion surface that matters
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
  | ScoutNotificationDeliveryV2Result
  /** The Activity throws instead of answering: an unobserved send. */
  | { outcome: "throw" };

export type ScoutV2NotificationStore = {
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
  overrides: Partial<ScoutV2NotificationStore> = {},
): ScoutV2NotificationStore {
  return {
    intent: pendingIntent(),
    policy: "normal",
    renders: 0,
    sends: [],
    script: [{ outcome: "delivered", messageId: MESSAGE_ID }],
    calls: [],
    failAt: null,
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

function requireIntent(store: ScoutV2NotificationStore): NotificationIntent {
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
  store: ScoutV2NotificationStore,
  result: NotificationTransitionResult,
): ScoutNotificationTransitionV2Result {
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
function gateFor(store: ScoutV2NotificationStore): ScoutNotificationGateV2 {
  const intent = requireIntent(store);
  const target = intent.target.kind;
  return {
    kind: intent.kind,
    target,
    policy: store.policy,
    decision: notificationDeliveryDecision(store.policy, target),
  };
}

function nextScripted(store: ScoutV2NotificationStore): ScriptedDelivery {
  const head = store.script.length > 1 ? store.script.shift() : store.script[0];
  if (head === undefined) throw new Error("the delivery script ran dry");
  return head;
}

export function scoutV2NotificationStubs(store: ScoutV2NotificationStore) {
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
    readNotificationIntentV2: (): ScoutNotificationIntentV2Result => {
      record("readNotificationIntentV2");
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
    markNotificationReadyV2: (): ScoutNotificationTransitionV2Result => {
      record("markNotificationReadyV2");
      return applyIntentTransition(store, markReady(requireIntent(store)));
    },
    renderNotificationArtifactV2: (): ScoutNotificationRenderV2Result => {
      record("renderNotificationArtifactV2");
      const reused = store.renders > 0;
      store.renders += 1;
      return { outcome: reused ? "reused" : "rendered" };
    },
    beginNotificationSendV2: (
      input: ScoutIntentAttemptRefV2,
    ): ScoutNotificationTransitionV2Result => {
      record("beginNotificationSendV2");
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
    deliverNotificationV2: (
      input: ScoutIntentAttemptRefV2,
    ): ScoutNotificationDeliveryV2Result => {
      record("deliverNotificationV2");
      // Recorded BEFORE the outcome is decided, because a send that threw
      // still reached Discord as far as this fake is concerned — which is
      // exactly the ambiguity the nonce exists to make visible.
      store.sends.push(input.attemptNonce);
      const scripted = nextScripted(store);
      if (scripted.outcome === "throw") {
        throw ApplicationFailure.nonRetryable(
          "the send did not answer",
          "AmbiguousProviderAttempt",
        );
      }
      return scripted;
    },
    recordNotificationOutcomeV2: (
      input: ScoutNotificationOutcomeV2Input,
    ): ScoutNotificationTransitionV2Result => {
      record("recordNotificationOutcomeV2");
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

export type ScoutV2LakeStore = {
  stagedFileCount: number;
  calls: string[];
  /** Attempts that throw before one succeeds, modelling a strict door. */
  failuresBeforeSuccess: number;
};

export function createLakeStore(
  overrides: Partial<ScoutV2LakeStore> = {},
): ScoutV2LakeStore {
  return {
    stagedFileCount: 3,
    calls: [],
    failuresBeforeSuccess: 0,
    ...overrides,
  };
}

export function scoutV2LakeStubs(store: ScoutV2LakeStore) {
  return {
    stageLakeProjectionV2: (): ScoutLakeStagingV2Result => {
      store.calls.push("stageLakeProjectionV2");
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

export type ScoutV2RecoveryStore = {
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
  overrides: Partial<ScoutV2RecoveryStore> = {},
): ScoutV2RecoveryStore {
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

function requireBatch(store: ScoutV2RecoveryStore): RecoveryBatch {
  if (store.batch === null) {
    throw ApplicationFailure.nonRetryable("no batch", "MissingDomainRecord");
  }
  return store.batch;
}

function applyBatchTransition(
  store: ScoutV2RecoveryStore,
  result: RecoveryTransitionResult,
): ScoutRecoveryTransitionV2Result {
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

export function scoutV2RecoveryStubs(store: ScoutV2RecoveryStore) {
  return {
    readRecoveryBatchV2: (): ScoutRecoveryBatchStateV2Result => {
      store.calls.push("readRecoveryBatchV2");
      if (store.batch === null) return { kind: "absent" };
      return {
        kind: "present",
        policy: store.batch.policy,
        state: store.batch.state,
      };
    },
    scanRecoveryPageV2: (): ScoutRecoveryScanV2Result => {
      store.calls.push("scanRecoveryPageV2");
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
    processRecoveryPageV2: (): ScoutRecoveryProcessV2Result => {
      store.calls.push("processRecoveryPageV2");
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
    digestRecoveryBatchV2: (): ScoutRecoveryTransitionV2Result => {
      store.calls.push("digestRecoveryBatchV2");
      return applyBatchTransition(store, beginDigest(requireBatch(store)));
    },
    closeRecoveryBatchV2: (): ScoutRecoveryTransitionV2Result => {
      store.calls.push("closeRecoveryBatchV2");
      return applyBatchTransition(store, completeBatch(requireBatch(store)));
    },
  };
}

// ─── Reconciliation ────────────────────────────────────────────────────────

export type ScoutV2ReconciliationStore = {
  /** One entry per page the scan will serve, in order. */
  pages: ScoutReconciliationScanV2Result["pending"][];
  scanned: number;
  triggers: string[];
};

export function emptyPending(): ScoutReconciliationScanV2Result["pending"] {
  return {
    matchProcessing: [],
    notifications: [],
    lakeProjections: [],
    recoveryBatches: [],
  };
}

export function createReconciliationStore(
  overrides: Partial<ScoutV2ReconciliationStore> = {},
): ScoutV2ReconciliationStore {
  return { pages: [emptyPending()], scanned: 0, triggers: [], ...overrides };
}

export function scoutV2ReconciliationStubs(store: ScoutV2ReconciliationStore) {
  return {
    scanPipelineReconciliationPageV2: (input: {
      trigger: string;
    }): ScoutReconciliationScanV2Result => {
      store.triggers.push(input.trigger);
      const pending = store.pages[store.scanned] ?? emptyPending();
      store.scanned += 1;
      return { complete: store.scanned >= store.pages.length, pending };
    },
  };
}
