import type { PrismaClient } from "#generated/prisma/client/index.js";
import type {
  PlayerRecord,
  PlayerStats,
  RaceSummary,
} from "@discord-plays-mario-kart/common";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { PlayerDirectory } from "#src/auth/player-directory.ts";
import type { RaceCompleted } from "./race-watcher.ts";

/**
 * Persistence boundary for race results. Kept as a narrow interface so
 * dispatch/tracker tests can use an in-memory fake.
 *
 * Multi-tenant: every method is scoped to one Discord guild. A store created via
 * `createPrismaLeaderboardStore(prisma, players).forGuild(guildId)` only
 * reads/writes rows tagged with that guildId. A request from server A can never
 * see server B's rows.
 *
 * Stats count only rows with a Discord id: races from before sign-in were
 * keyed by typed names anyone could claim, so they stay in the database but
 * out of the standings.
 */
export type LeaderboardStore = {
  recordRace: (race: RaceCompleted) => Promise<void>;
  leaderboard: (limit?: number) => Promise<PlayerRecord[]>;
  playerStats: (discordId: string) => Promise<PlayerStats | null>;
  recentRaces: (limit?: number) => Promise<RaceSummary[]>;
};

/** Pool-level factory: hand out a per-guild `LeaderboardStore` on demand. */
export type LeaderboardStoreFactory = {
  forGuild: (guildId: string) => LeaderboardStore;
  /** The guild of the most recently recorded race, for a page with no game running. */
  latestGuildId: () => Promise<string | undefined>;
};

const DEFAULT_LIMIT = 10;
const RECENT_LIMIT = 10;
// Time Trials excluded: a solo run against a ghost is trivially "1st place".
const RANKED_MODES = ["gp", "versus"];
const GAME_MODES = ["gp", "versus", "time-trials"] as const;

type ResultRow = {
  discordId: string | null;
  playerName: string | null;
  placement: number;
  character: number;
  raceTimeMs: number;
  finished: boolean;
};

type RaceRow = {
  id: number;
  finishedAt: Date;
  courseId: number;
  gameMode: string;
  results: ResultRow[];
};

function gameModeOf(raw: string): RaceSummary["gameMode"] {
  const mode = GAME_MODES.find((candidate) => candidate === raw);
  if (mode === undefined) throw new Error(`unknown recorded game mode ${raw}`);
  return mode;
}

/** The directory's current face for a player, else the name they raced under. */
function playerFor(
  discordId: string,
  raceName: string | null,
  directory: Map<string, DiscordUser>,
): DiscordUser {
  const known = directory.get(discordId);
  if (known !== undefined) return known;
  const name = raceName ?? discordId;
  return { discordId, username: name, name, avatarUrl: null };
}

function summarize(
  race: RaceRow,
  directory: Map<string, DiscordUser>,
): RaceSummary {
  return {
    id: race.id,
    finishedAtMs: race.finishedAt.getTime(),
    courseId: race.courseId,
    gameMode: gameModeOf(race.gameMode),
    results: race.results
      .toSorted((a, b) => a.placement - b.placement)
      .map((result) => ({
        player:
          result.discordId === null
            ? null
            : playerFor(result.discordId, result.playerName, directory),
        name: result.playerName,
        placement: result.placement,
        characterId: result.character,
        raceTimeMs: result.raceTimeMs,
        finished: result.finished,
      })),
  };
}

/** Aggregate one player's ranked results into a record. */
export function recordOf(
  player: DiscordUser,
  placements: readonly number[],
): PlayerRecord {
  const races = placements.length;
  const wins = placements.filter((placement) => placement === 1).length;
  const podiums = placements.filter((placement) => placement <= 3).length;
  const total = placements.reduce((sum, placement) => sum + placement, 0);
  return {
    player,
    races,
    wins,
    podiums,
    losses: races - wins,
    averagePlacement: races > 0 ? total / races : 8,
    winRate: races > 0 ? wins / races : 0,
  };
}

/** Wins first, then the better average place, then the busier player. */
export function compareRecords(a: PlayerRecord, b: PlayerRecord): number {
  return (
    b.wins - a.wins ||
    a.averagePlacement - b.averagePlacement ||
    b.races - a.races
  );
}

/** Current names and avatars for every Discord player in some races. */
async function directoryFor(
  players: PlayerDirectory,
  races: readonly RaceRow[],
): Promise<Map<string, DiscordUser>> {
  const ids = races.flatMap((race) =>
    race.results.flatMap((result) =>
      result.discordId === null ? [] : [result.discordId],
    ),
  );
  return players.getMany(ids);
}

export function createPrismaLeaderboardStore(
  prisma: PrismaClient,
  players: PlayerDirectory,
): LeaderboardStoreFactory {
  return {
    async latestGuildId() {
      const race = await prisma.race.findFirst({
        where: { gameId: "mk64" },
        orderBy: { id: "desc" },
        select: { guildId: true },
      });
      return race?.guildId;
    },

    forGuild(guildId: string): LeaderboardStore {
      const ranked = {
        discordId: { not: null },
        race: {
          is: { guildId, gameId: "mk64", gameMode: { in: RANKED_MODES } },
        },
      };
      const raceInclude = {
        results: {
          select: {
            discordId: true,
            playerName: true,
            placement: true,
            character: true,
            raceTimeMs: true,
            finished: true,
          },
        },
      };

      return {
        async recordRace(race: RaceCompleted): Promise<void> {
          // Nested create = one transaction: the Race row and all its results
          // land atomically or not at all.
          await prisma.race.create({
            data: {
              guildId,
              gameId: "mk64",
              courseId: race.courseId,
              gameMode: race.gameMode,
              humanCount: race.humanCount,
              results: {
                create: race.results.map((r) => ({
                  seat: r.seat,
                  playerName: r.player?.name ?? null,
                  discordId: r.player?.discordId ?? null,
                  character: r.characterId,
                  placement: r.placement,
                  raceTimeMs: r.raceTimeMs,
                  finished: r.finished,
                })),
              },
            },
          });
        },

        async leaderboard(limit = DEFAULT_LIMIT): Promise<PlayerRecord[]> {
          const rows = await prisma.raceResult.findMany({
            where: ranked,
            orderBy: { id: "desc" },
            select: { discordId: true, playerName: true, placement: true },
          });
          const placements = new Map<string, number[]>();
          const lastName = new Map<string, string | null>();
          for (const row of rows) {
            if (row.discordId === null) continue;
            const list = placements.get(row.discordId) ?? [];
            list.push(row.placement);
            placements.set(row.discordId, list);
            if (!lastName.has(row.discordId)) {
              lastName.set(row.discordId, row.playerName);
            }
          }
          const directory = await players.getMany([...placements.keys()]);
          return [...placements]
            .map(([discordId, list]) =>
              recordOf(
                playerFor(
                  discordId,
                  lastName.get(discordId) ?? null,
                  directory,
                ),
                list,
              ),
            )
            .toSorted(compareRecords)
            .slice(0, limit);
        },

        async playerStats(discordId: string): Promise<PlayerStats | null> {
          const rows = await prisma.raceResult.findMany({
            where: { ...ranked, discordId },
            orderBy: { id: "desc" },
            select: {
              playerName: true,
              placement: true,
              character: true,
              raceTimeMs: true,
              finished: true,
              race: { select: { courseId: true } },
            },
          });
          const latest = rows[0];
          if (latest === undefined) return null;

          const histogram = Array.from({ length: 8 }, () => 0);
          const characters = new Map<number, number>();
          const best = new Map<
            number,
            { raceTimeMs: number; characterId: number }
          >();
          for (const row of rows) {
            histogram[row.placement - 1] =
              (histogram[row.placement - 1] ?? 0) + 1;
            characters.set(
              row.character,
              (characters.get(row.character) ?? 0) + 1,
            );
            if (!row.finished || row.raceTimeMs <= 0) continue;
            const current = best.get(row.race.courseId);
            if (current === undefined || row.raceTimeMs < current.raceTimeMs) {
              best.set(row.race.courseId, {
                raceTimeMs: row.raceTimeMs,
                characterId: row.character,
              });
            }
          }
          let favoriteCharacterId: number | null = null;
          let favoriteCount = 0;
          for (const [characterId, count] of characters) {
            if (count > favoriteCount) {
              favoriteCharacterId = characterId;
              favoriteCount = count;
            }
          }

          const recentRaces: RaceRow[] = await prisma.race.findMany({
            where: {
              guildId,
              gameId: "mk64",
              gameMode: { in: RANKED_MODES },
              results: { some: { discordId } },
            },
            orderBy: { id: "desc" },
            take: RECENT_LIMIT,
            include: raceInclude,
          });
          const directory = await directoryFor(players, recentRaces);
          const player = playerFor(discordId, latest.playerName, directory);
          const record = recordOf(
            player,
            rows.map((row) => row.placement),
          );
          return {
            record,
            placements: histogram,
            bestTimes: [...best]
              .map(([courseId, time]) => ({ courseId, ...time }))
              .toSorted((a, b) => a.courseId - b.courseId),
            favoriteCharacterId,
            recent: recentRaces.map((race) => summarize(race, directory)),
          };
        },

        async recentRaces(limit = RECENT_LIMIT): Promise<RaceSummary[]> {
          const races: RaceRow[] = await prisma.race.findMany({
            where: {
              guildId,
              gameId: "mk64",
              gameMode: { in: RANKED_MODES },
              results: { some: { discordId: { not: null } } },
            },
            orderBy: { id: "desc" },
            take: limit,
            include: raceInclude,
          });
          const directory = await directoryFor(players, races);
          return races.map((race) => summarize(race, directory));
        },
      };
    },
  };
}
