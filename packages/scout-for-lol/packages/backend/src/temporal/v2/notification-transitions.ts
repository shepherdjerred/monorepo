import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  markReady,
  recordFailure,
  recordUnknownDelivery,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import type {
  ScoutNotificationDeliveryV2Result,
  ScoutNotificationOutcomeV2Input,
  ScoutNotificationTransitionV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type {
  ScoutIntentAttemptRefV2,
  ScoutIntentRefV2,
} from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import { transitionIntent } from "#src/database/durable/intent-repository.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import {
  policyHeldCommit,
  resolveNotificationGateV2,
} from "#src/temporal/v2/notification/notification-policy.ts";
import { retireIfAudienceGoneV2 } from "#src/temporal/v2/notification/intent-audience.ts";
import {
  notificationTransitionV2,
  requireIntentRecordV2,
} from "#src/temporal/v2/notification-reads.ts";

/**
 * The three durable steps of one send, as the intent machine defines them.
 *
 * Nothing here decides anything. Every legality question — may this intent be
 * sent, does this nonce match the attempt in flight, is this state terminal —
 * is answered by the pure domain transition running over the stored snapshot,
 * and the repository writes the result behind a guard on exactly the state that
 * snapshot observed. A racing writer therefore comes back as the domain's own
 * `already-applied` or `conflict` after a re-read, never as a lost update.
 *
 * The split into three Activities is the crash contract. The attempt nonce is
 * committed BEFORE the Discord call and the outcome AFTER it, so a worker that
 * dies mid-send leaves an attempt that is identifiable rather than a gap. That
 * is the whole reason `beginNotificationSendV2` exists as its own step instead
 * of being folded into the send.
 */

export async function markNotificationReadyV2(
  input: ScoutIntentRefV2,
): Promise<ScoutNotificationTransitionV2Result> {
  return await notificationTransitionV2(
    input.intentKey,
    await transitionIntent(prisma, {
      intentKey: input.intentKey,
      transition: markReady,
    }),
  );
}

/**
 * Commit the attempt nonce, before anything is sent.
 *
 * `startedAt` is this moment rather than a caller-supplied instant, and that
 * matters: `beginSend` refuses an attempt started after the intent's freshness
 * deadline, which is the guard that stops a recovery sweep announcing a match
 * nobody is still watching. v1's adoption path passes the instant a send REALLY
 * began because it is completing a record after the fact; this is a live send,
 * so the clock is the truth.
 *
 * The policy gate is asked FIRST, against the batch row as it stands now, and
 * a held intent is refused with `policy-held` before any transition runs: no
 * nonce is minted, the attempt count does not move, and the row is exactly as
 * it was. The Workflow already stops on a hold at its opening read; this is
 * the write boundary, and it does not rely on the caller having asked.
 *
 * The audience is asked next, for an unattempted intent only: one whose
 * subscription, channel or guild was deleted since the mint is retired
 * (`retireIfAudienceGoneV2`) instead of begun. That is the point of
 * discovery, and it is before the nonce on purpose — an intent that is
 * `sending` is never retired, so the only moment the send path can retire
 * one is the moment before it would start sending.
 */
export async function beginNotificationSendV2(
  input: ScoutIntentAttemptRefV2,
): Promise<ScoutNotificationTransitionV2Result> {
  const record = await requireIntentRecordV2(input.intentKey);
  const gate = await resolveNotificationGateV2(record);
  if (gate.decision === "held") {
    return {
      commit: policyHeldCommit(),
      state: record.intent.state,
      attemptCount: record.intent.attemptCount,
    };
  }
  const retired = await retireIfAudienceGoneV2(prisma, record);
  if (retired !== undefined) {
    // No attempt is minted and the count does not move: the intent is
    // `suppressed` with the reason its audience went, which the Workflow
    // reads as the machine having said its piece, exactly as it reads a
    // freshness refusal here.
    return await notificationTransitionV2(input.intentKey, retired);
  }
  const startedAt = toIsoInstant(new Date());
  return await notificationTransitionV2(
    input.intentKey,
    await transitionIntent(prisma, {
      intentKey: input.intentKey,
      transition: (intent) =>
        beginSend(intent, { attemptNonce: input.attemptNonce, startedAt }),
    }),
  );
}

/**
 * The transition one observed delivery outcome calls for.
 *
 * `unknown` is not a failure and must never become one. The request left, the
 * response did not arrive, and `recordUnknownDelivery` parks the intent in the
 * domain's deliberate dead end — left only by an operator who looked, because
 * any automatic retry risks telling a user the same thing twice.
 *
 * A `failed` outcome carries the domain's own classification rather than a
 * guess made here: retryable returns the intent to `ready`, terminal moves it
 * to `permission-denied`. Which of those a Discord error is belongs to the
 * sender, which is the only code that saw the error.
 */
function outcomeTransition(
  input: ScoutIntentAttemptRefV2,
  delivery: ScoutNotificationDeliveryV2Result,
): (intent: NotificationIntent) => NotificationTransitionResult {
  const attemptNonce = input.attemptNonce;
  switch (delivery.outcome) {
    case "delivered": {
      const deliveredAt = toIsoInstant(new Date());
      return (intent) =>
        confirmDelivered(intent, {
          attemptNonce,
          deliveredAt,
          ...(delivery.messageId === undefined
            ? {}
            : { messageId: delivery.messageId }),
        });
    }
    case "failed":
      return (intent) =>
        recordFailure(intent, { attemptNonce, failure: delivery.failure });
    case "unknown": {
      const observedAt = toIsoInstant(new Date());
      return (intent) =>
        recordUnknownDelivery(intent, { attemptNonce, observedAt });
    }
  }
}

export async function recordNotificationOutcomeV2(
  input: ScoutNotificationOutcomeV2Input,
): Promise<ScoutNotificationTransitionV2Result> {
  return await notificationTransitionV2(
    input.intentKey,
    await transitionIntent(prisma, {
      intentKey: input.intentKey,
      transition: outcomeTransition(input, input.delivery),
    }),
  );
}
