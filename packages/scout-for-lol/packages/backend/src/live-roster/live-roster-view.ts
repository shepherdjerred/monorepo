import type { Rank } from "@scout-for-lol/data";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { LIVE_ROSTER_LIVE_WINDOW_MS } from "#src/live-roster/live-roster-retention.ts";
import {
  LiveRecentFormMapSchema,
  LiveRosterParticipantsSchema,
  type LiveRecentForm,
} from "#src/live-roster/live-roster-schema.ts";

/**
 * What the consumer Live game endpoints return, read from PostgreSQL alone.
 *
 * Nothing here calls Riot, and nothing reads S3 or the report lake: a page
 * view costs two or three indexed queries however many people open it.
 * Strangers' PUUIDs never leave this module. The browser gets a Riot ID, a
 * champion, a kit and a short summary; only a friend carries an identity the
 * app can link to.
 */

/** The most live games one viewer is shown. A friend group is not this big. */
const MAX_LISTED_GAMES = 20;

export type LiveFriend = {
  readonly playerId: number;
  readonly alias: string;
  readonly guildId: DiscordGuildId;
};

export type LiveGameParticipantView = {
  readonly riotId: string | null;
  readonly teamId: number;
  readonly championId: number;
  readonly spell1Id: number;
  readonly spell2Id: number;
  readonly keystoneId: number | null;
  readonly primaryTreeId: number | null;
  readonly secondaryTreeId: number | null;
  readonly lane: string | null;
  /** The rank Scout held when the game was detected; null when it held none. */
  readonly rank: Rank | null;
  /** The viewer's own friend, resolved in the viewer's servers. */
  readonly friend: LiveFriend | null;
  /** A stranger's last ranked games; null until fetched, or for a friend. */
  readonly recentForm: LiveRecentForm | null;
};

export type LiveGameView = {
  readonly riotMatchId: string;
  readonly gameId: string;
  readonly platform: string;
  readonly queueId: number;
  readonly gameMode: string;
  readonly startedAt: Date | null;
  readonly detectedAt: Date;
  readonly ended: boolean;
  /** True once every untracked player's recent form has been settled. */
  readonly recentFormComplete: boolean;
  readonly participants: readonly LiveGameParticipantView[];
};

export type LiveGameSummary = Pick<
  LiveGameView,
  "riotMatchId" | "gameId" | "platform" | "queueId" | "startedAt" | "detectedAt"
> & {
  readonly friends: readonly (LiveFriend & {
    readonly championId: number;
    readonly lane: string | null;
  })[];
};

type RosterRow = NonNullable<
  Awaited<ReturnType<ExtendedPrismaClient["liveGameRoster"]["findUnique"]>>
>;

/** The viewer's friends in these servers, by the PUUID of each account. */
async function friendsByPuuid(
  guildIds: readonly DiscordGuildId[],
  database: ExtendedPrismaClient,
): Promise<Map<string, LiveFriend>> {
  const accounts = await database.account.findMany({
    where: { serverId: { in: [...guildIds] } },
    select: {
      puuid: true,
      serverId: true,
      player: { select: { id: true, alias: true } },
    },
  });
  return new Map(
    accounts.map((account) => [
      account.puuid,
      {
        playerId: account.player.id,
        alias: account.player.alias,
        guildId: account.serverId,
      },
    ]),
  );
}

async function endedAmong(
  riotMatchIds: readonly string[],
  database: ExtendedPrismaClient,
): Promise<Set<string>> {
  if (riotMatchIds.length === 0) return new Set();
  const rows = await database.matchTrackedAccount.findMany({
    where: { riotMatchId: { in: [...riotMatchIds] } },
    select: { riotMatchId: true },
    distinct: ["riotMatchId"],
  });
  return new Set(rows.map((row) => row.riotMatchId));
}

function viewOf(
  row: RosterRow,
  friends: ReadonlyMap<string, LiveFriend>,
  ended: boolean,
): LiveGameView {
  const forms = LiveRecentFormMapSchema.parse(row.recentForm);
  return {
    riotMatchId: row.riotMatchId,
    gameId: row.gameId,
    platform: row.platform,
    queueId: row.queueId,
    gameMode: row.gameMode,
    startedAt: row.gameStartedAt,
    detectedAt: row.detectedAt,
    ended,
    recentFormComplete: row.recentFormCompletedAt !== null,
    participants: LiveRosterParticipantsSchema.parse(row.participants).map(
      (participant) => ({
        riotId: participant.riotId,
        teamId: participant.teamId,
        championId: participant.championId,
        spell1Id: participant.spell1Id,
        spell2Id: participant.spell2Id,
        keystoneId: participant.keystoneId,
        primaryTreeId: participant.primaryTreeId,
        secondaryTreeId: participant.secondaryTreeId,
        lane: participant.lane,
        rank: participant.rank,
        friend:
          participant.puuid === null
            ? null
            : (friends.get(participant.puuid) ?? null),
        recentForm:
          participant.puuid === null || participant.isTracked
            ? null
            : (forms[participant.puuid] ?? null),
      }),
    ),
  };
}

/**
 * The games a viewer's servers have someone in that are still being played,
 * newest first.
 *
 * A game is listed while it is inside its live window and the post-match core
 * has not recorded it; a game the viewer is not connected to by a tracked
 * account in their servers is never listed, whatever else the table holds.
 */
export async function listLiveGames(
  guildIds: readonly DiscordGuildId[],
  now: Date,
  database: ExtendedPrismaClient = prisma,
): Promise<LiveGameSummary[]> {
  const friends = await friendsByPuuid(guildIds, database);
  if (friends.size === 0) return [];
  const rows = await database.liveGameRoster.findMany({
    where: {
      detectedAt: { gt: new Date(now.getTime() - LIVE_ROSTER_LIVE_WINDOW_MS) },
      trackedPuuids: { hasSome: [...friends.keys()] },
    },
    orderBy: { detectedAt: "desc" },
    take: MAX_LISTED_GAMES,
  });
  const ended = await endedAmong(
    rows.map((row) => row.riotMatchId),
    database,
  );
  return rows
    .filter((row) => !ended.has(row.riotMatchId))
    .map((row) => {
      const game = viewOf(row, friends, false);
      return {
        riotMatchId: game.riotMatchId,
        gameId: game.gameId,
        platform: game.platform,
        queueId: game.queueId,
        startedAt: game.startedAt,
        detectedAt: game.detectedAt,
        friends: game.participants.flatMap((participant) =>
          participant.friend === null
            ? []
            : [
                {
                  ...participant.friend,
                  championId: participant.championId,
                  lane: participant.lane,
                },
              ],
        ),
      };
    });
}

/**
 * One game's roster, or null when the viewer has no friend in it (or there is
 * no such roster): the two are indistinguishable on purpose.
 *
 * A game that just ended still resolves, marked `ended`, until the retention
 * window closes.
 */
export async function getLiveGame(
  input: {
    guildIds: readonly DiscordGuildId[];
    riotMatchId: string;
    now: Date;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<LiveGameView | null> {
  const row = await database.liveGameRoster.findUnique({
    where: { riotMatchId: input.riotMatchId },
  });
  // A row past its window is gone, however long the purge takes to say so.
  if (row === null || row.expiresAt <= input.now) return null;
  const friends = await friendsByPuuid(input.guildIds, database);
  if (!row.trackedPuuids.some((puuid) => friends.has(puuid))) return null;
  const ended = await endedAmong([row.riotMatchId], database);
  return viewOf(row, friends, ended.has(row.riotMatchId));
}
