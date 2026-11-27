import * as Sentry from "@sentry/bun";
import {
  RankSchema,
  isArenaQueueOrMode,
  type Lane,
  type RawCurrentGameInfo,
  type RawCurrentGameParticipant,
  type Rank,
} from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { inferSpectatorLanes } from "#src/league/tasks/prematch/spectator-lanes.ts";
import {
  liveRosterExpiresAt,
  liveRosterLiveUntil,
} from "#src/live-roster/live-roster-retention.ts";
import {
  LiveRosterParticipantsSchema,
  LIVE_ROSTER_MAX_PARTICIPANTS,
  type LiveRosterParticipant,
} from "#src/live-roster/live-roster-schema.ts";
import { createLogger } from "#src/logger.ts";
import type { ScoutPrematchContext } from "#src/temporal/prematch/prematch-context.ts";

const logger = createLogger("live-roster-record");

function parseStoredRank(serialized: string | null): Rank | null {
  return serialized === null || serialized.length === 0
    ? null
    : RankSchema.parse(JSON.parse(serialized));
}

/**
 * The Solo/Duo rank Scout already knows for each tracked player: the newer of
 * the current-rank snapshot and the latest rank a recorded game left behind.
 *
 * Detection never calls Riot for a rank. A player Scout has no rank evidence
 * for is simply absent from the map, and their row carries `rank: null`.
 */
async function trackedSoloRanks(
  puuids: readonly string[],
  database: ExtendedPrismaClient,
): Promise<Map<string, Rank>> {
  const ranks = new Map<string, Rank>();
  if (puuids.length === 0) return ranks;
  const [snapshots, history] = await Promise.all([
    database.currentRankSnapshot.findMany({
      where: { puuid: { in: [...puuids] }, soloRank: { not: null } },
      select: { puuid: true, soloRank: true, fetchedAt: true },
    }),
    database.matchRankHistory.findMany({
      where: {
        puuid: { in: [...puuids] },
        queueType: "solo",
        rankAfter: { not: null },
      },
      orderBy: [
        { matchGameEndAt: { sort: "desc", nulls: "last" } },
        { capturedAt: "desc" },
      ],
      distinct: ["puuid"],
      select: { puuid: true, rankAfter: true, capturedAt: true },
    }),
  ]);
  const gameRank = new Map(history.map((row) => [row.puuid, row] as const));
  for (const snapshot of snapshots) {
    const game = gameRank.get(snapshot.puuid);
    const useSnapshot =
      game === undefined || snapshot.fetchedAt > game.capturedAt;
    const rank = parseStoredRank(
      useSnapshot ? snapshot.soloRank : game.rankAfter,
    );
    if (rank !== null) ranks.set(snapshot.puuid, rank);
  }
  for (const [puuid, row] of gameRank) {
    if (ranks.has(puuid)) continue;
    const rank = parseStoredRank(row.rankAfter);
    if (rank !== null) ranks.set(puuid, rank);
  }
  return ranks;
}

function participantOf(input: {
  participant: RawCurrentGameParticipant;
  lane: Lane | null;
  isTracked: boolean;
  rank: Rank | null;
}): LiveRosterParticipant {
  const { participant } = input;
  const perkIds = participant.perks?.perkIds;
  // Riot scrubs a hidden participant's identity: the payload then has no puuid
  // and a champion name where the Riot ID would be.
  const identified = participant.puuid !== null;
  return {
    puuid: identified ? LeaguePuuidSchema.parse(participant.puuid) : null,
    riotId: identified ? participant.riotId : null,
    teamId: participant.teamId,
    championId: participant.championId,
    spell1Id: participant.spell1Id,
    spell2Id: participant.spell2Id,
    keystoneId: perkIds?.[0] ?? null,
    primaryTreeId: participant.perks?.perkStyle ?? null,
    secondaryTreeId: participant.perks?.perkSubStyle ?? null,
    lane: input.lane,
    rank: input.rank,
    isTracked: input.isTracked,
  };
}

/** Whether a spectator payload is a lobby the Live game page can show. */
export function isRecordableLiveGame(game: RawCurrentGameInfo): boolean {
  return (
    !isArenaQueueOrMode(game.gameQueueConfigId, game.gameMode) &&
    game.participants.length > 0 &&
    game.participants.length <= LIVE_ROSTER_MAX_PARTICIPANTS
  );
}

/**
 * Build the roster's participants from a spectator payload.
 *
 * Pure apart from the rank read. `trackedPuuids` is every account Scout
 * tracks that is in this game, in any server.
 */
export function buildLiveRosterParticipants(input: {
  game: RawCurrentGameInfo;
  trackedPuuids: ReadonlySet<string>;
  ranksByPuuid: ReadonlyMap<string, Rank>;
}): LiveRosterParticipant[] {
  const lanes = inferSpectatorLanes(input.game.participants);
  return LiveRosterParticipantsSchema.parse(
    input.game.participants.map((participant, index) =>
      participantOf({
        participant,
        lane: lanes?.get(index) ?? null,
        isTracked:
          participant.puuid !== null &&
          input.trackedPuuids.has(participant.puuid),
        rank:
          participant.puuid === null
            ? null
            : (input.ranksByPuuid.get(participant.puuid) ?? null),
      }),
    ),
  );
}

export type LiveRosterRecordOutcome =
  "recorded" | "already-recorded" | "skipped";

/**
 * Write the roster row for a game the prematch path just captured.
 *
 * The first capture wins and a replay changes nothing: a retried or resumed
 * capture must not reset `detectedAt`, which the retention window counts from,
 * nor erase the recent form the follow-up already stored.
 */
export async function recordLiveGameRoster(
  context: ScoutPrematchContext,
  observedAt: Date,
  database: ExtendedPrismaClient = prisma,
): Promise<LiveRosterRecordOutcome> {
  const game = context.gameInfo;
  if (!isRecordableLiveGame(game)) return "skipped";
  const gameParticipants = new Set(
    game.participants.flatMap((participant) =>
      participant.puuid === null ? [] : [participant.puuid],
    ),
  );
  const trackedPuuids = new Set(
    context.trackedPlayers
      .map((player) => player.league.leagueAccount.puuid)
      .filter((puuid) => gameParticipants.has(puuid)),
  );
  const participants = buildLiveRosterParticipants({
    game,
    trackedPuuids,
    ranksByPuuid: await trackedSoloRanks([...trackedPuuids], database),
  });
  const created = await database.liveGameRoster.createMany({
    data: [
      {
        riotMatchId: context.riotMatchId,
        platform: game.platformId,
        gameId: game.gameId.toString(),
        queueId: game.gameQueueConfigId,
        gameMode: game.gameMode,
        gameStartedAt:
          game.gameStartTime > 0 ? new Date(game.gameStartTime) : null,
        detectedAt: observedAt,
        expiresAt: liveRosterExpiresAt(observedAt),
        participants,
        trackedPuuids: [...trackedPuuids],
      },
    ],
    skipDuplicates: true,
  });
  logger.info(
    `📋 Live roster for ${context.riotMatchId}: ${created.count === 0 ? "already recorded" : `${participants.length.toString()} participants, live until ${liveRosterLiveUntil(observedAt).toISOString()}`}`,
  );
  return created.count === 0 ? "already-recorded" : "recorded";
}

/**
 * Record the roster without letting its failure touch the capture.
 *
 * The roster is read by one page; the capture's other effects are a
 * notification promise. A broken roster write is reported loudly (logged and
 * sent to Bugsink) but must not fail the Activity, whose retry would hold the
 * game-start announcement back and, exhausted, fail the whole capture.
 */
export async function recordLiveGameRosterOrReport(
  context: ScoutPrematchContext,
  observedAt: Date,
  database: ExtendedPrismaClient = prisma,
): Promise<LiveRosterRecordOutcome | "failed"> {
  try {
    return await recordLiveGameRoster(context, observedAt, database);
  } catch (error) {
    logger.error(
      `❌ Live roster for ${context.riotMatchId} could not be recorded`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "live-roster-record", riotMatchId: context.riotMatchId },
    });
    return "failed";
  }
}
