import type { LeaguePuuid, QueueType } from "@scout-for-lol/data";
import {
  canonicalMatchTournamentCode,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data";
import type {
  MatchNotificationIntentRecord,
  NotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { notificationOptOuts } from "#src/database/riot-accounts.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/subscribed-channels.ts";
import { readReportScoreboard } from "#src/evidence/report-scoreboard.ts";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import { resolveScoutObservedMatchContext } from "#src/temporal/match/match-context.ts";
import { requireArchivedPrematchContext } from "./prematch-notification.ts";

export type MatchNotificationSubjects = {
  puuids: LeaguePuuid[];
  queueType: QueueType | undefined;
};

async function readSubjects(
  record: MatchNotificationIntentRecord,
): Promise<MatchNotificationSubjects> {
  if (record.intent.kind === "prematch") {
    const context = await requireArchivedPrematchContext(record.matchId);
    return {
      puuids: context.trackedPlayers.map(
        (player) => player.league.leagueAccount.puuid,
      ),
      queueType: resolveQueueTypeFromGame(
        context.gameInfo.gameQueueConfigId,
        context.gameInfo.gameMode,
        context.gameInfo.gameType,
      ),
    };
  }
  const scoreboard = await readReportScoreboard(record.matchId);
  if (scoreboard !== null) {
    return {
      puuids: scoreboard.trackedPuuids,
      queueType: resolveQueueTypeFromGame(
        scoreboard.result.queueId,
        scoreboard.result.gameMode,
        scoreboard.result.gameType,
      ),
    };
  }
  const context = await resolveScoutObservedMatchContext(record.matchId);
  return {
    puuids: [...context.observedPuuids],
    queueType: resolveQueueTypeFromGame(
      context.matchData.info.queueId,
      context.matchData.info.gameMode,
      context.matchData.info.gameType,
      canonicalMatchTournamentCode(context.matchData),
    ),
  };
}

/** Current owner preferences are read at every boundary; the report content stays intact. */
export async function matchNotificationPreferenceSuppression(
  record: NotificationIntentRecord,
  db: ExtendedPrismaClient = prisma,
  subjects: (
    record: MatchNotificationIntentRecord,
  ) => Promise<MatchNotificationSubjects> = readSubjects,
): Promise<"recipient-preference" | undefined> {
  if (
    !("matchId" in record) ||
    (record.intent.kind !== "prematch" && record.intent.kind !== "postmatch") ||
    record.intent.target.kind !== "channel"
  )
    return undefined;
  if (
    (await db.riotAccountPreference.findFirst({
      where: { matchNotificationsEnabled: false },
      select: { puuid: true },
    })) === null
  )
    return undefined;
  const { puuids, queueType } = await subjects(record);
  const optedOut = await notificationOptOuts(puuids, db);
  if (optedOut.size === 0) return undefined;
  const channelId = record.intent.target.channelId;
  // A queued notice still needs an eligible account in this channel. Muting,
  // filtering, or deleting a subscription cannot restore an opted-out trigger.
  const eligible = channelsPassingQueueFilter(
    await getChannelsSubscribedToPlayers(puuids, db),
    queueType,
  );
  return eligible.some((channel) => channel.channel === channelId)
    ? undefined
    : "recipient-preference";
}
