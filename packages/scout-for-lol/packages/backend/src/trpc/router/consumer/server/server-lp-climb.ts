import { prisma } from "#src/database/index.ts";
import {
  lpDeltaBetween,
  parseSnapshot,
} from "#src/trpc/router/consumer/match-lp-delta.ts";
import type { ServerPlayer } from "#src/trpc/router/consumer/server/server-people.ts";

/**
 * Solo/Duo LP gained since `sinceMs`, per player id, summed over the player's
 * accounts from `MatchRankHistory`. A game whose snapshots state no difference
 * (placements, a move across the Master line) adds nothing, never an estimate.
 */
export async function loadWeeklyLpClimbs(
  players: ServerPlayer[],
  sinceMs: number,
): Promise<Map<number, number>> {
  const ownerByPuuid = new Map(
    players.flatMap((player) =>
      player.accounts.map((account) => [account.puuid, player.id] as const),
    ),
  );
  const since = new Date(sinceMs);
  const records =
    ownerByPuuid.size === 0
      ? []
      : await prisma.matchRankHistory.findMany({
          where: {
            puuid: { in: [...ownerByPuuid.keys()] },
            queueType: "solo",
            OR: [
              { matchGameEndAt: { gte: since } },
              { matchGameEndAt: null, capturedAt: { gte: since } },
            ],
          },
          select: { puuid: true, rankBefore: true, rankAfter: true },
        });
  const climbs = new Map<number, number>();
  for (const record of records) {
    const playerId = ownerByPuuid.get(record.puuid);
    const rankAfter = parseSnapshot(record.rankAfter);
    if (playerId === undefined || rankAfter === null) continue;
    const delta = lpDeltaBetween(parseSnapshot(record.rankBefore), rankAfter);
    if (delta === null) continue;
    climbs.set(playerId, (climbs.get(playerId) ?? 0) + delta);
  }
  return climbs;
}
