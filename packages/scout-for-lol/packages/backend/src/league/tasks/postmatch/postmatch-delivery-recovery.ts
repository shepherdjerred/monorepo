import {
  listCompletedScoutEffects,
  DISCORD_CHANNEL_MESSAGE_EFFECT_KIND,
} from "#src/temporal/effect-claims.ts";
import { tryCreateChannelDeliveryRecorder } from "#src/durable/match/delivery-intents.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("postmatch-delivery-recovery");

/**
 * How far outside the derived window a claim may still be recognised.
 *
 * Three clocks bound the window and none of them is the same one: Riot stamps
 * `gameCreation`, the application decides staleness from its own clock, and
 * `claimedAt` defaults to the database's `now()`. The cost of the window being
 * a little too narrow is a delivery that can never be recovered — the bug this
 * whole path exists to fix — while the cost of it being too wide is a few more
 * index entries scanned, so it is deliberately generous.
 */
const CLAIM_WINDOW_SLACK_MS = 60 * 60 * 1000;

/**
 * Finish the durable record of sends this match already made, whatever the
 * pipeline decides about sending now.
 *
 * `deliverToChannels` can adopt an unfinished intent only for a channel it is
 * currently delivering to, and it is reached only when the report is still
 * sendable at all. Everything in between — the match's age, the tracked
 * players, the current subscriptions, the queue filters — gates SENDING, and a
 * send that already happened is indifferent to all of it. A channel
 * unsubscribed after its report went out, or a match that turned three hours
 * old before anything retried it, would otherwise leave an intent that no code
 * path could ever finish. So this runs first and unconditionally, and it is the
 * one place that adopts completed claims regardless of eligibility.
 *
 * Nothing is sent here, and nothing can be: it only reads claims the pipeline
 * already COMPLETED and records what they prove. `deliverToChannels` still
 * takes its own claim before any send, so running this first cannot produce a
 * duplicate message.
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
  gameCreation: number;
  freshnessDeadline: Date;
}): Promise<void> {
  try {
    // This runs on every pass, so the lookup has to be index-served. It is
    // shaped for the `[kind, state, claimedAt]` index rather than for a prefix
    // match on the primary key, which Postgres cannot serve from a btree under
    // these databases' `en_US.utf8` collation and would turn into a sequential
    // scan of every claim ever made. Measured over 20k claims: an index scan
    // touching 17 buffers, the window narrowing to a few hundred entries and
    // the key prefix filtering those down to this match's.
    //
    // The time window is sound by the invariant the delivery gate already
    // enforces. `claimedAt` records when a send BEGAN, and a send can only
    // begin while the report is still sendable — never before the game existed,
    // never after `postmatchReportFreshnessDeadline`. So every claim this match
    // could own was stamped inside that span, widened by the slack above
    // because the three instants come from three different clocks.
    const completed = await listCompletedScoutEffects({
      kind: DISCORD_CHANNEL_MESSAGE_EFFECT_KIND,
      keyPrefix: `${args.effectKeyPrefix}:`,
      claimedFrom: new Date(args.gameCreation - CLAIM_WINDOW_SLACK_MS),
      claimedUntil: new Date(
        args.freshnessDeadline.getTime() + CLAIM_WINDOW_SLACK_MS,
      ),
    });
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
