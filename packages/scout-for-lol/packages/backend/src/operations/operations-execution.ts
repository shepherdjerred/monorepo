/**
 * Executing a confirmed operations intent.
 *
 * Everything here runs inside the transaction that claimed the intent, so the
 * claim, the durable transition and the audit row commit together or not at
 * all. Each arm drives the FROZEN domain machine — `suppressStale`,
 * `operatorResolveUnknown`, `operatorReleasePolicy` — through the repository's
 * guarded update, so an operator and a Workflow contend through the same
 * `applied` / `already-applied` / `conflict` answer rather than through two
 * different notions of legality.
 *
 * No arm starts a Workflow. Starting one inside the transaction would announce
 * work that a rollback then un-asks for, so a start is DESCRIBED here and
 * dispatched after commit by `workflow-dispatch.ts`. That is why the outcome
 * for those arms is `start-authorized` and not `started`: at the moment it is
 * written to the intent's stored result, nothing has been started, and a
 * replayed confirmation must not claim otherwise.
 *
 * Unlike the creation arms, every claimed operations confirmation records an
 * audit row, including a refusal. The operator spent a single-use
 * authorization either way, and a refused pipeline operation during an
 * incident is exactly what a later reviewer needs to see.
 */

import type { OperationsIntentPayload } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  NotificationIntentState,
  OperatorUnknownResolution,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  operatorResolveUnknown,
  suppressStale,
  type NotificationConflictReason,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  operatorReleasePolicy,
  type RecoveryConflictReason,
  type RecoveryTransitionResult,
} from "@scout-for-lol/domain/recovery/batch-transitions.ts";
import {
  getIntent,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import { getProcessingState } from "#src/database/durable/observation-repository.ts";
import {
  getRecoveryBatch,
  transitionRecoveryBatch,
} from "#src/database/durable/recovery-repository.ts";
import type { AuditDetail } from "#src/lib/audit/audited-mutation.ts";
import type { OperationsWorkflowStart } from "#src/operations/workflow-dispatch.ts";

/** What the target of an operations intent is, when it is missing. */
export type OperationsTargetKind =
  "notification-intent" | "match" | "recovery-batch";

export type OperationsOutcome =
  /**
   * The request was claimed and authorized. The Workflow start is dispatched
   * after this transaction commits; nothing is running yet.
   */
  | {
      readonly kind: "start-authorized";
      readonly workflow: OperationsWorkflowStart["kind"];
    }
  /** The notification intent moved to `suppressed`. */
  | { readonly kind: "notification-suppressed"; readonly intentKey: string }
  /**
   * The unknown attempt was answered. `intentState` is read off the state the
   * machine actually produced, never inferred from the operator's answer.
   */
  | {
      readonly kind: "delivery-resolved";
      readonly intentKey: string;
      readonly intentState: NotificationIntentState["kind"];
    }
  /** The recovery batch's blast-radius policy was widened. */
  | {
      readonly kind: "recovery-policy-released";
      readonly recoveryBatchId: string;
    }
  /** The durable machine had already made exactly this change. */
  | { readonly kind: "already-applied" }
  /** The durable machine refused, in its own closed vocabulary. */
  | {
      readonly kind: "machine-refused";
      readonly reason: NotificationConflictReason | RecoveryConflictReason;
    }
  /**
   * The intent is not in a state a notification Workflow can drive. Reported
   * separately from `machine-refused` because this is an observation made
   * here, not an answer the machine gave.
   */
  | {
      readonly kind: "not-drivable";
      readonly intentKey: string;
      readonly intentState: NotificationIntentState["kind"];
    }
  /** The thing the intent names has no durable row. */
  | {
      readonly kind: "target-not-found";
      readonly target: OperationsTargetKind;
      readonly id: string;
    };

export type OperationsExecution = {
  readonly outcome: OperationsOutcome;
  readonly audit: AuditDetail;
  readonly postCommit: OperationsWorkflowStart | null;
};

/** The states a notification Workflow can pick up and drive to a send. */
const DRIVABLE_INTENT_STATES: ReadonlySet<NotificationIntentState["kind"]> =
  new Set<NotificationIntentState["kind"]>(["pending", "ready"]);

function notFound(target: OperationsTargetKind, id: string): OperationsOutcome {
  return { kind: "target-not-found", target, id };
}

function fromTransition(
  result: NotificationTransitionResult | RecoveryTransitionResult,
  applied: OperationsOutcome,
): OperationsOutcome {
  switch (result.outcome) {
    case "applied":
      return applied;
    case "already-applied":
      return { kind: "already-applied" };
    case "conflict":
      return { kind: "machine-refused", reason: result.reason };
  }
}

async function executeRetryNotification(
  tx: Db,
  payload: OperationsIntentPayload & { kind: "ops_retry_notification" },
): Promise<{
  outcome: OperationsOutcome;
  postCommit: OperationsWorkflowStart | null;
}> {
  const record = await getIntent(tx, { intentKey: payload.intentKey });
  if (record === null) {
    return {
      outcome: notFound("notification-intent", payload.intentKey),
      postCommit: null,
    };
  }
  const intentState = record.intent.state.kind;
  if (!DRIVABLE_INTENT_STATES.has(intentState)) {
    return {
      outcome: {
        kind: "not-drivable",
        intentKey: payload.intentKey,
        intentState,
      },
      postCommit: null,
    };
  }
  return {
    outcome: { kind: "start-authorized", workflow: "retry-notification" },
    postCommit: { kind: "retry-notification", intentKey: payload.intentKey },
  };
}

async function executeSuppressStale(
  tx: Db,
  payload: OperationsIntentPayload & {
    kind: "ops_suppress_stale_notification";
  },
  now: Date,
): Promise<OperationsOutcome> {
  const record = await getIntent(tx, { intentKey: payload.intentKey });
  if (record === null) {
    return notFound("notification-intent", payload.intentKey);
  }
  const at = IsoInstantSchema.parse(now.toISOString());
  const result = await transitionIntent(tx, {
    intentKey: payload.intentKey,
    transition: (intent) => suppressStale(intent, { at }),
  });
  return fromTransition(result, {
    kind: "notification-suppressed",
    intentKey: payload.intentKey,
  });
}

async function executeResolveUnknownDelivery(
  tx: Db,
  payload: OperationsIntentPayload & { kind: "ops_resolve_unknown_delivery" },
): Promise<OperationsOutcome> {
  const record = await getIntent(tx, { intentKey: payload.intentKey });
  if (record === null) {
    return notFound("notification-intent", payload.intentKey);
  }
  const { answer } = payload;
  const resolution: OperatorUnknownResolution =
    answer.outcome === "delivered"
      ? {
          outcome: "delivered",
          attemptNonce: answer.attemptNonce,
          messageId: answer.messageId,
          deliveredAt: answer.deliveredAt,
        }
      : { outcome: "confirmed-unsent", attemptNonce: answer.attemptNonce };
  const result = await transitionIntent(tx, {
    intentKey: payload.intentKey,
    transition: (intent) => operatorResolveUnknown(intent, resolution),
  });
  return result.outcome === "applied"
    ? {
        kind: "delivery-resolved",
        intentKey: payload.intentKey,
        intentState: result.next.state.kind,
      }
    : fromTransition(result, { kind: "already-applied" });
}

async function executeRepairProjection(
  tx: Db,
  payload: OperationsIntentPayload & { kind: "ops_repair_projection" },
): Promise<{
  outcome: OperationsOutcome;
  postCommit: OperationsWorkflowStart | null;
}> {
  // Keyed on the observation alone, exactly as `getMatchPipelineState` is: a
  // match this pipeline never saw has no projection to repair. Whether there
  // is anything left to stage is the projection Workflow's own question.
  const processing = await getProcessingState(tx, {
    matchId: payload.riotMatchId,
  });
  if (processing === null) {
    return {
      outcome: notFound("match", payload.riotMatchId),
      postCommit: null,
    };
  }
  return {
    outcome: { kind: "start-authorized", workflow: "repair-projection" },
    postCommit: {
      kind: "repair-projection",
      riotMatchId: payload.riotMatchId,
    },
  };
}

async function executeReleaseRecoveryPolicy(
  tx: Db,
  payload: OperationsIntentPayload & { kind: "ops_release_recovery_policy" },
): Promise<OperationsOutcome> {
  const batch = await getRecoveryBatch(tx, {
    recoveryBatchId: payload.recoveryBatchId,
  });
  if (batch === null) {
    return notFound("recovery-batch", payload.recoveryBatchId);
  }
  const result = await transitionRecoveryBatch(tx, {
    recoveryBatchId: payload.recoveryBatchId,
    transition: (current) => operatorReleasePolicy(current, { to: payload.to }),
  });
  return fromTransition(result, {
    kind: "recovery-policy-released",
    recoveryBatchId: payload.recoveryBatchId,
  });
}

function auditFor(
  payload: OperationsIntentPayload,
  outcome: OperationsOutcome,
): AuditDetail {
  const action = OPERATIONS_AUDIT_ACTIONS[payload.kind];
  return { action, payload: { ...payload, outcome: outcome.kind } };
}

const OPERATIONS_AUDIT_ACTIONS = {
  ops_reconcile_pipeline: "OPS_PIPELINE_RECONCILE",
  ops_retry_notification: "OPS_NOTIFICATION_RETRY",
  ops_suppress_stale_notification: "OPS_NOTIFICATION_SUPPRESS",
  ops_resolve_unknown_delivery: "OPS_DELIVERY_RESOLVE",
  ops_repair_projection: "OPS_PROJECTION_REPAIR",
  ops_release_recovery_policy: "OPS_RECOVERY_POLICY_RELEASE",
} as const satisfies Record<
  OperationsIntentPayload["kind"],
  AuditDetail["action"]
>;

/**
 * Perform the operation a confirmed intent describes, inside `tx`.
 *
 * @throws when a durable repository cannot apply a transition it was asked to
 * apply — a contended row that never settles, or a stored value that does not
 * parse. Those must roll the caller's transaction back and leave the intent
 * unconsumed rather than persist a claim with no effect.
 */
export async function executeOperationsIntent(
  tx: Db,
  params: { payload: OperationsIntentPayload; now: Date },
): Promise<OperationsExecution> {
  const { payload, now } = params;
  const { outcome, postCommit } = await runArm(tx, payload, now);
  return { outcome, audit: auditFor(payload, outcome), postCommit };
}

async function runArm(
  tx: Db,
  payload: OperationsIntentPayload,
  now: Date,
): Promise<{
  outcome: OperationsOutcome;
  postCommit: OperationsWorkflowStart | null;
}> {
  switch (payload.kind) {
    case "ops_reconcile_pipeline":
      return {
        outcome: { kind: "start-authorized", workflow: "reconcile-pipeline" },
        postCommit: { kind: "reconcile-pipeline" },
      };
    case "ops_retry_notification":
      return await executeRetryNotification(tx, payload);
    case "ops_repair_projection":
      return await executeRepairProjection(tx, payload);
    case "ops_suppress_stale_notification":
      return {
        outcome: await executeSuppressStale(tx, payload, now),
        postCommit: null,
      };
    case "ops_resolve_unknown_delivery":
      return {
        outcome: await executeResolveUnknownDelivery(tx, payload),
        postCommit: null,
      };
    case "ops_release_recovery_policy":
      return {
        outcome: await executeReleaseRecoveryPolicy(tx, payload),
        postCommit: null,
      };
  }
}
