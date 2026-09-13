import { listCompletedScoutEffects } from "#src/temporal/effect-claims.ts";
import { tryCreateChannelDeliveryRecorder } from "#src/durable/match/delivery-intents.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("postmatch-delivery-recovery");

/**
 * Finish the durable record of sends this match already made, when the report
 * itself is too old to send.
 *
 * The delivery gate returns early for a stale match, so the completed-claim
 * branch inside `deliverToChannels` — the one that adopts an intent an earlier
 * pass left unfinished — is never reached. That is the hole this closes: a run
 * whose Discord send succeeded but whose intent writes were lost leaves a row
 * that only a later pass can finish, and if no pass arrives before the match
 * goes stale, every later pass takes the early return and the row strands
 * forever. Recovery therefore has to be independent of send eligibility.
 *
 * Nothing is sent here, and nothing can be: this only reads claims the
 * pipeline already completed and records what they prove.
 *
 * The instants come from the claim row rather than from the message id's
 * Discord snowflake. Both are real evidence, but they describe different
 * moments: the snowflake says when Discord created the message, while
 * `beginSend`'s guard is about when the SEND BEGAN, which is what `claimedAt`
 * records — the claim is taken immediately before the send runs. Using the one
 * row that also proves the delivery keeps the evidence to a single source.
 */
export async function recoverCompletedPostmatchDeliveries(args: {
  matchId: string;
  effectKeyPrefix: string;
  freshnessDeadline: Date;
}): Promise<void> {
  try {
    // Scoped to this match's own claim keys: a stale match with nothing to
    // recover costs one indexed lookup that returns no rows, and this runs on
    // ordinary polls.
    const completed = await listCompletedScoutEffects(
      `${args.effectKeyPrefix}:`,
    );
    if (completed.length === 0) return;

    const record = tryCreateChannelDeliveryRecorder({
      facts: liveDurableFacts(),
      matchId: args.matchId,
      keyPrefix: args.effectKeyPrefix,
      freshnessDeadline: args.freshnessDeadline,
    });
    if (record === null) return;

    for (const claim of completed) {
      // The claim key is `<prefix>:<channelId>`, so the channel is the segment
      // the prefix does not cover.
      const channelId = claim.key.slice(args.effectKeyPrefix.length + 1);
      await record({
        kind: "already-delivered",
        channelId,
        messageId: claim.resultId,
        send: {
          startedAt: claim.claimedAt,
          deliveredAt: claim.completedAt,
        },
      });
    }
    logger.info(
      `[processMatch] 📓 Recorded ${completed.length.toString()} already-delivered notification intent(s) for stale match ${args.matchId}`,
    );
  } catch (error) {
    // Recovery is bookkeeping for a report that is not going out either way.
    // It must never change what the stale path does.
    logger.error(
      `[processMatch] ❌ Could not reconcile completed deliveries for stale match ${args.matchId}`,
      error,
    );
  }
}
