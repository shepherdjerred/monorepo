import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  suppress,
  type NotificationTransitionResult,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { prisma } from "#src/database/index.ts";
import { transitionIntent } from "#src/database/durable/intent-repository.ts";
import type { NotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { hallRecordBreakSuppressionV2 } from "#src/temporal/v2/notification/hall-record-break-notification.ts";
import { duelStatusSuppressionV2 } from "#src/temporal/v2/notification/duel-status-notification.ts";
import { dareStatusSuppressionV2 } from "#src/temporal/v2/notification/dare-status-notification.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/v2/notification/announcement-codecs.ts";

async function deferMalformedAnnouncement(
  check: () => Promise<NotificationPolicySuppressionReason | undefined>,
): Promise<NotificationPolicySuppressionReason | undefined> {
  try {
    return await check();
  } catch (error) {
    // The pre-send phase records malformed content terminally.
    if (error instanceof MalformedAnnouncementIntentError) return undefined;
    throw error;
  }
}

/**
 * Whether the intent's KIND forbids sending it now, and why.
 *
 * The recovery gate (`notification-policy.ts`) asks where an intent came from;
 * this asks what it announces. Some kinds carry a per-recipient product policy
 * v1 re-checked at every delivery — a Hall announcement goes out only while
 * its guild has `hall_of_fame_enabled` — and an intent minted while the policy
 * allowed it must still be stopped if the policy changed before the send.
 *
 * The answer is a SUPPRESSION, not a hold: a hold waits for an operator to
 * widen a batch's policy, while a feature a guild turned off is a decision
 * about this notification, recorded terminally with its reason through the
 * domain's `suppress`. Turning the feature back on does not resurrect an
 * announcement about an old match.
 *
 * Exhaustive over the kinds, so a kind added to the domain has to say whether
 * it has a policy before this compiles.
 */
async function kindSuppressionOfV2(
  record: NotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  switch (record.intent.kind) {
    case "dare-status":
      if (!("dareId" in record))
        throw new Error("Dare status requires a Dare subject");
      return await deferMalformedAnnouncement(
        async () => await dareStatusSuppressionV2(record),
      );
    case "duel-status":
      if (!("duelId" in record))
        throw new Error("Duel status requires a Duel subject");
      return await deferMalformedAnnouncement(
        async () => await duelStatusSuppressionV2(record),
      );
    case "hall-record-break":
      if (!("matchId" in record))
        throw new Error("Hall notification requires a match subject");
      return await deferMalformedAnnouncement(
        async () => await hallRecordBreakSuppressionV2(record),
      );
    case "postmatch":
    case "prematch":
    case "settlement":
    case "dare-summary":
      return undefined;
  }
}

/**
 * Suppress the intent if its kind's policy forbids it, before it is readied or
 * an attempt is minted.
 *
 * `undefined` means the policy permits it — or the intent is not one this may
 * touch — and the caller proceeds as it always did. Only `pending` and `ready`
 * are asked about: an attempted intent belongs to its attempt or the operator,
 * and the domain would refuse to suppress it anyway. A suppression that loses a
 * race (a conflict) also answers `undefined`, so the caller's own transition
 * produces the answer it would have produced without this step — the same
 * contract as the audience check beside it.
 */
export async function suppressIfKindPolicyForbidsV2(
  record: NotificationIntentRecord,
): Promise<NotificationTransitionResult | undefined> {
  const state = record.intent.state.kind;
  if (state !== "pending" && state !== "ready") return undefined;
  const reason = await kindSuppressionOfV2(record);
  if (reason === undefined) return undefined;
  const result = await transitionIntent(prisma, {
    intentKey: record.intent.key,
    transition: (intent) => suppress(intent, { reason }),
  });
  return result.outcome === "conflict" ? undefined : result;
}
