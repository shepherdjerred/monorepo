import type { LeaguePuuid, Ranks } from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * The `CurrentRankSnapshot` writer: one row per account holding the current
 * rank of each queue as JSON, `null` for a queue the player has no rank in,
 * and when Riot was asked (`fetchedAt`). An unranked player's row has all three
 * ranks `null`; the row still records that the question was asked.
 */
export async function upsertCurrentRankSnapshot(
  db: ExtendedPrismaClient | Db,
  input: { puuid: LeaguePuuid; ranks: Ranks; fetchedAt: Date },
): Promise<void> {
  const stored = {
    soloRank:
      input.ranks.solo === undefined ? null : JSON.stringify(input.ranks.solo),
    flexRank:
      input.ranks.flex === undefined ? null : JSON.stringify(input.ranks.flex),
    ranked5sRank:
      input.ranks.ranked5s === undefined
        ? null
        : JSON.stringify(input.ranks.ranked5s),
    fetchedAt: input.fetchedAt,
  };
  await db.currentRankSnapshot.upsert({
    where: { puuid: input.puuid },
    create: { puuid: input.puuid, ...stored },
    update: stored,
  });
}
