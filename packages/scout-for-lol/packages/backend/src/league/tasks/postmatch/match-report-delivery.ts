import {
  DiscordGuildIdSchema,
  MatchIdSchema,
  resolveQueueTypeFromGame,
  type DiscordChannelId,
  type DiscordGuildId,
  type LeaguePuuid,
  type Player,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { PostmatchRankChanges } from "#src/betting/dares/lifecycle/dare-rank-capture-v3.ts";
import { uniqueBy } from "remeda";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import {
  getPrematchMessageIdsForMatchIdOrEmpty,
  recordPostmatchMessageIds,
} from "#src/league/tasks/prematch/active-game-queries.ts";
import {
  channelsPassingQueueFilter,
  deliverToChannels,
} from "#src/league/tasks/notification-filters.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { recoverCompletedPostmatchDeliveries } from "#src/league/tasks/postmatch/postmatch-delivery-recovery.ts";
import {
  deliveredMessagesByGuild,
  recordDeliveryReceipts,
  tryCreateChannelDeliveryRecorder,
} from "#src/durable/match/delivery-intents.ts";

const logger = createLogger("postmatch-report-delivery");
export const MAX_DISCORD_ALERT_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * The instant after which this match's report is stale.
 *
 * This is v1's own staleness rule and the notification intent's freshness
 * deadline — ONE derivation, consumed by both, because the two must be the
 * same instant. The delivery gate below refuses to send past it, and the
 * intent's `beginSend` refuses to record a send started past it, so a pass
 * that clears the gate is always inside the deadline. That is what lets the
 * completed-claim recovery in `delivery-intents.ts` adopt a proven delivery
 * through `beginSend` without tripping the freshness guard; two expressions of
 * "3 hours" that could drift apart would quietly break it.
 */
export function postmatchReportFreshnessDeadline(gameCreation: number): Date {
  return new Date(gameCreation + MAX_DISCORD_ALERT_AGE_MS);
}

/** Both this and `beginSend` compare STRICTLY after, so the deadline itself still delivers. */
export function isPostmatchReportStale(
  gameCreation: number,
  now: Date,
): boolean {
  return (
    now.getTime() > postmatchReportFreshnessDeadline(gameCreation).getTime()
  );
}

/** Generate and deliver one non-silent post-match report. */
export async function deliverPostmatchReport(input: {
  matchData: RawMatch;
  trackedPlayers: PlayerConfigEntry[];
  prefetchedTimeline?: RawTimeline | null;
  prefetchedPlayers?: Player[] | undefined;
  prefetchedRankChanges?: PostmatchRankChanges | undefined;
}): Promise<Map<DiscordChannelId, string>> {
  const matchId = MatchIdSchema.parse(input.matchData.metadata.matchId);
  const effectKeyPrefix = `postmatch-discord:${matchId}`;
  // Staleness is decided before anything is looked up, for two reasons: an old
  // match should not pay for a channel query it cannot use, and recovery must
  // not sit behind a return that depends on CURRENT subscriptions. A match
  // whose channels were all removed after its report went out still has
  // deliveries to finish recording, and the claim keys that prove them do not
  // depend on who is subscribed now.
  if (isPostmatchReportStale(input.matchData.info.gameCreation, new Date())) {
    const matchAgeMs = Date.now() - input.matchData.info.gameCreation;
    const ageHours = (matchAgeMs / (60 * 60 * 1000)).toFixed(1);
    logger.info(
      `[processMatch] ⏰ Skipping match ${matchId} — ${ageHours}h old (cutoff ${(MAX_DISCORD_ALERT_AGE_MS / (60 * 60 * 1000)).toString()}h)`,
    );
    // Too old to SEND is not too old to RECORD. The completed-claim branch in
    // `deliverToChannels` never runs for a stale match, so this is the only
    // pass that can still finish an intent an earlier send left unwritten.
    await recoverCompletedPostmatchDeliveries({
      matchId,
      effectKeyPrefix,
      freshnessDeadline: postmatchReportFreshnessDeadline(
        input.matchData.info.gameCreation,
      ),
    });
    return new Map();
  }
  const playersInMatch = input.trackedPlayers.filter((player) =>
    input.matchData.metadata.participants.includes(
      player.league.leagueAccount.puuid,
    ),
  );
  const puuids: LeaguePuuid[] = playersInMatch.map(
    (player) => player.league.leagueAccount.puuid,
  );
  const channels = await getChannelsSubscribedToPlayers(puuids);
  const queueType = resolveQueueTypeFromGame(
    input.matchData.info.queueId,
    input.matchData.info.gameMode,
    input.matchData.info.gameType,
  );
  const deliverChannels = channelsPassingQueueFilter(channels, queueType);
  if (deliverChannels.length === 0) {
    logger.info(
      `[processMatch] 🔕 No delivery channels for match ${matchId} (queue ${queueType ?? "unknown"}, ${channels.length.toString()} subscribed)`,
    );
    return new Map();
  }
  const targetGuildIds: DiscordGuildId[] = uniqueBy(
    deliverChannels.map((channel) =>
      DiscordGuildIdSchema.parse(channel.serverId),
    ),
    (id) => id,
  );
  const message = await generateMatchReport(
    input.matchData,
    input.trackedPlayers,
    {
      targetGuildIds,
      ...(input.prefetchedTimeline === undefined
        ? {}
        : { prefetchedTimeline: input.prefetchedTimeline }),
      ...(input.prefetchedPlayers === undefined
        ? {}
        : { prefetchedPlayers: input.prefetchedPlayers }),
      ...(input.prefetchedRankChanges === undefined
        ? {}
        : { prefetchedRankChanges: input.prefetchedRankChanges }),
    },
  );
  if (!message) {
    logger.info(`[processMatch] ⚠️  No message generated for match ${matchId}`);
    return new Map();
  }
  const facts = liveDurableFacts();
  const delivery = await deliverToChannels({
    message,
    channels: deliverChannels,
    logPrefix: "[processMatch]",
    sentryTags: { matchId },
    replyToMessageIds: await getPrematchMessageIdsForMatchIdOrEmpty(matchId),
    effectKeyPrefix,
    recordDelivery:
      tryCreateChannelDeliveryRecorder({
        facts,
        matchId,
        keyPrefix: effectKeyPrefix,
        // The same derivation the gate above used, so the instant a report
        // stops being sendable and the instant its intent goes stale cannot
        // drift apart.
        freshnessDeadline: postmatchReportFreshnessDeadline(
          input.matchData.info.gameCreation,
        ),
      }) ?? undefined,
  });
  await recordCoreOutputsDelivered(delivery.deliveredGuildIds, "postmatch");
  await recordPostmatchMessageIds(matchId, delivery.messageIdsByChannel);
  await recordDeliveryReceipts({
    facts,
    kind: "reportDelivery",
    matchId,
    messagesByGuild: deliveredMessagesByGuild(
      deliverChannels,
      delivery.messageIdsByChannel,
    ),
  });
  return delivery.messageIdsByChannel;
}
