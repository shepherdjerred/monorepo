import type { MatchId, LeaguePuuid, Rank } from "@scout-for-lol/data";
import { RankSchema } from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("rank-history");

/**
 * Store rank history for a match
 */
export async function saveMatchRankHistory(params: {
  matchId: MatchId;
  puuid: LeaguePuuid;
  queueType: "solo" | "flex";
  rankBefore: Rank | undefined;
  rankAfter: Rank | undefined;
}): Promise<void> {
  const { matchId, puuid, queueType, rankBefore, rankAfter } = params;

  await prisma.matchRankHistory.upsert({
    where: {
      matchId_puuid_queueType: { matchId, puuid, queueType },
    },
    create: {
      matchId,
      puuid,
      queueType,
      rankBefore: rankBefore ? JSON.stringify(rankBefore) : null,
      rankAfter: rankAfter ? JSON.stringify(rankAfter) : null,
      capturedAt: new Date(),
    },
    update: {
      rankAfter: rankAfter ? JSON.stringify(rankAfter) : null,
      capturedAt: new Date(),
    },
  });

  logger.info(`[saveMatchRankHistory] Saved rank history for ${puuid} in match ${matchId} (${queueType})`);
}

/**
 * Get the most recent rank before a specific timestamp
 */
export async function getLatestRankBefore(
  puuid: LeaguePuuid,
  queueType: "solo" | "flex",
  beforeTimestamp: number,
): Promise<Rank | undefined> {
  const records = await prisma.matchRankHistory.findMany({
    where: {
      puuid,
      queueType,
      capturedAt: {
        lt: new Date(beforeTimestamp),
      },
    },
    orderBy: {
      capturedAt: "desc",
    },
    take: 1,
  });

  if (records.length === 0) {
    return undefined;
  }

  const record = records[0];
  return record?.rankAfter ? RankSchema.parse(JSON.parse(record.rankAfter)) : undefined;
}
