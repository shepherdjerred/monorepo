import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { LeaderboardEntry } from "@discord-plays-mario-kart/common";
import type { RaceCompleted } from "./race-watcher.ts";

/**
 * Persistence boundary for race results. Kept as a narrow interface so
 * dispatch/tracker tests can use an in-memory fake.
 *
 * Multi-tenant: every method is scoped to one Discord guild. A store created via
 * `createPrismaLeaderboardStore(prisma).forGuild(guildId)` only reads/writes rows
 * tagged with that guildId. A request from server A can never see server B's rows.
 */
export type LeaderboardStore = {
  recordRace: (race: RaceCompleted) => Promise<void>;
  leaderboard: (limit?: number) => Promise<LeaderboardEntry[]>;
};

/** Pool-level factory: hand out a per-guild `LeaderboardStore` on demand. */
export type LeaderboardStoreFactory = {
  forGuild: (guildId: string) => LeaderboardStore;
};

/** Identity key for case-insensitive name aggregation. */
export function playerKeyOf(name: string | null): string | null {
  if (name === null) return null;
  const key = name.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

const DEFAULT_LIMIT = 10;
// Time Trials excluded: a solo run against a ghost is trivially "1st place".
const RANKED_MODES = ["gp", "versus"];

export function createPrismaLeaderboardStore(
  prisma: PrismaClient,
): LeaderboardStoreFactory {
  return {
    forGuild(guildId: string): LeaderboardStore {
      return {
        async recordRace(race: RaceCompleted): Promise<void> {
          // Nested create = one transaction: the Race row and all its results
          // land atomically or not at all.
          await prisma.race.create({
            data: {
              guildId,
              courseId: race.courseId,
              gameMode: race.gameMode,
              humanCount: race.humanCount,
              results: {
                create: race.results.map((r) => ({
                  seat: r.seat,
                  playerName: r.name?.trim() ?? null,
                  playerKey: playerKeyOf(r.name),
                  character: r.characterId,
                  placement: r.placement,
                  raceTimeMs: r.raceTimeMs,
                  finished: r.finished,
                })),
              },
            },
          });
        },

        async leaderboard(limit = DEFAULT_LIMIT): Promise<LeaderboardEntry[]> {
          const ranked = {
            playerKey: { not: null },
            race: { is: { guildId, gameMode: { in: RANKED_MODES } } },
          };
          const [racesByKey, winsByKey, recentNames] = await Promise.all([
            prisma.raceResult.groupBy({
              by: ["playerKey"],
              where: ranked,
              _count: { _all: true },
            }),
            prisma.raceResult.groupBy({
              by: ["playerKey"],
              where: { ...ranked, placement: 1 },
              _count: { _all: true },
            }),
            // Newest-first names; first occurrence per key wins (most recent casing).
            prisma.raceResult.findMany({
              where: {
                playerKey: { not: null },
                race: { is: { guildId } },
              },
              orderBy: { id: "desc" },
              select: { playerKey: true, playerName: true },
            }),
          ]);

          const wins = new Map<string, number>();
          for (const w of winsByKey) {
            if (w.playerKey !== null) wins.set(w.playerKey, w._count._all);
          }
          const displayName = new Map<string, string>();
          for (const r of recentNames) {
            if (
              r.playerKey !== null &&
              r.playerName !== null &&
              !displayName.has(r.playerKey)
            ) {
              displayName.set(r.playerKey, r.playerName);
            }
          }

          const entries: LeaderboardEntry[] = [];
          for (const row of racesByKey) {
            if (row.playerKey === null) continue;
            const races = row._count._all;
            const won = wins.get(row.playerKey) ?? 0;
            entries.push({
              name: displayName.get(row.playerKey) ?? row.playerKey,
              wins: won,
              races,
              winRate: races > 0 ? won / races : 0,
            });
          }
          entries.sort(
            (a, b) =>
              b.wins - a.wins || b.winRate - a.winRate || b.races - a.races,
          );
          return entries.slice(0, limit);
        },
      };
    },
  };
}
