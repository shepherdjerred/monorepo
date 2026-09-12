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
import {
  deliveredMessagesByGuild,
  recordDeliveryReceipts,
  tryCreateChannelDeliveryRecorder,
} from "#src/durable/match/delivery-intents.ts";

const logger = createLogger("postmatch-report-delivery");
const MAX_DISCORD_ALERT_AGE_MS = 3 * 60 * 60 * 1000;

/** Generate and deliver one non-silent post-match report. */
export async function deliverPostmatchReport(input: {
  matchData: RawMatch;
  trackedPlayers: PlayerConfigEntry[];
  prefetchedTimeline?: RawTimeline | null;
  prefetchedPlayers?: Player[] | undefined;
  prefetchedRankChanges?: PostmatchRankChanges | undefined;
}): Promise<Map<DiscordChannelId, string>> {
  const matchId = MatchIdSchema.parse(input.matchData.metadata.matchId);
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
  const matchAgeMs = Date.now() - input.matchData.info.gameCreation;
  if (matchAgeMs > MAX_DISCORD_ALERT_AGE_MS) {
    const ageHours = (matchAgeMs / (60 * 60 * 1000)).toFixed(1);
    logger.info(
      `[processMatch] ⏰ Skipping match ${matchId} — ${ageHours}h old (cutoff ${(MAX_DISCORD_ALERT_AGE_MS / (60 * 60 * 1000)).toString()}h)`,
    );
    return new Map();
  }
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
  const effectKeyPrefix = `postmatch-discord:${matchId}`;
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
        // v1's own staleness rule: a report older than this is never sent, so
        // it is exactly the instant after which the intent is stale.
        freshnessDeadline: new Date(
          input.matchData.info.gameCreation + MAX_DISCORD_ALERT_AGE_MS,
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
