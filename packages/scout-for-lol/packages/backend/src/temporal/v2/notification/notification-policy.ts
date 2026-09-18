import { ApplicationFailure } from "@temporalio/common";
import type { RecoveryPolicy } from "@scout-for-lol/domain/recovery/batch.ts";
import { notificationDeliveryDecision } from "@scout-for-lol/domain/recovery/delivery-policy.ts";
import {
  ScoutNotificationGateV2Schema,
  type ScoutNotificationGateV2,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import { prisma } from "#src/database/index.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { getRecoveryBatch } from "#src/database/durable/recovery-repository.ts";

/**
 * Whether one stored intent may be sent, decided from where it came from.
 *
 * The recovery policy is what makes `RecoveryPolicy` and
 * `operatorReleasePolicy` mean something on the delivery side. A live-born
 * intent runs under `normal`. A recovery-born intent names the batch that
 * minted it, and the policy is READ OFF THAT BATCH ROW every time this is
 * asked — never copied onto the intent — because the batch is the one row
 * the operator release transitions, through the frozen domain machine. A
 * copy would either make the release inert or require the release to rewrite
 * every intent the batch minted; the reference makes it reach them all at
 * once, at their next read.
 *
 * A recovery-born intent whose batch row does not exist is a broken internal
 * contract: nothing deletes batches, and an intent can only be minted by a
 * batch that already had a row. No retry produces one.
 *
 * The decision itself is the domain's (`notificationDeliveryDecision`); this
 * resolves the policy and hands over the target's kind. Three places apply
 * the result — the Workflow's opening read, `beginNotificationSendV2` before
 * it commits an attempt, and `deliverNotificationV2` before it builds a
 * message — and the reconciliation sweep's SQL excludes held intents by the
 * same rule so a held intent is not re-driven every minute for nothing.
 */
export async function resolveNotificationGateV2(
  record: MatchNotificationIntentRecord,
): Promise<ScoutNotificationGateV2> {
  const policy = await effectivePolicy(record);
  const target = record.intent.target.kind;
  return ScoutNotificationGateV2Schema.parse({
    kind: record.intent.kind,
    target,
    policy,
    decision: notificationDeliveryDecision(policy, target),
  });
}

async function effectivePolicy(
  record: MatchNotificationIntentRecord,
): Promise<RecoveryPolicy> {
  const origin = record.intent.origin;
  switch (origin.kind) {
    case "live":
      return "normal";
    case "recovery": {
      const batch = await getRecoveryBatch(prisma, {
        recoveryBatchId: origin.recoveryBatchId,
      });
      if (batch === null) {
        throw ApplicationFailure.nonRetryable(
          `Intent ${record.intent.key} was minted by recovery batch ${origin.recoveryBatchId}, which has no row; its delivery policy cannot be known`,
          "MissingDomainRecord",
        );
      }
      return batch.batch.policy;
    }
  }
}

/** The one refusal a held intent earns at a write boundary. */
export function policyHeldCommit(): {
  outcome: "conflict";
  reason: "policy-held";
} {
  return { outcome: "conflict", reason: "policy-held" };
}
