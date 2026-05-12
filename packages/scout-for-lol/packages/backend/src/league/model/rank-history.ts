import type { MatchId, LeaguePuuid, Rank } from "@scout-for-lol/data";
import { rankToLeaguePoints, RankSchema } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

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
  matchGameCreationTimestamp: number | undefined;
  matchGameEndTimestamp: number | undefined;
}): Promise<void> {
  const {
    matchId,
    puuid,
    queueType,
    rankBefore,
    rankAfter,
    matchGameCreationTimestamp,
    matchGameEndTimestamp,
  } = params;
  const matchGameCreationAt =
    matchGameCreationTimestamp === undefined
      ? null
      : new Date(matchGameCreationTimestamp);
  const matchGameEndAt =
    matchGameEndTimestamp === undefined
      ? null
      : new Date(matchGameEndTimestamp);

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
      matchGameCreationAt,
      matchGameEndAt,
      capturedAt: new Date(),
    },
    update: {
      rankBefore: rankBefore ? JSON.stringify(rankBefore) : null,
      rankAfter: rankAfter ? JSON.stringify(rankAfter) : null,
      matchGameCreationAt,
      matchGameEndAt,
      capturedAt: new Date(),
    },
  });

  logger.info(
    `[saveMatchRankHistory] Saved rank history for ${puuid} in match ${matchId} (${queueType})`,
  );
}

/**
 * Get the most recent rank before a specific timestamp
 */
export async function getLatestRankBefore(
  puuid: LeaguePuuid,
  queueType: "solo" | "flex",
  beforeTimestamp: number,
): Promise<Rank | undefined> {
  const before = new Date(beforeTimestamp);
  const records = await prisma.matchRankHistory.findMany({
    where: {
      puuid,
      queueType,
      OR: [
        { matchGameEndAt: { lt: before } },
        { matchGameEndAt: null, capturedAt: { lt: before } },
      ],
    },
    orderBy: { capturedAt: "desc" },
    take: 50,
  });

  if (records.length === 0) {
    return undefined;
  }

  const record = records.toSorted((left, right) => {
    const leftTime = (left.matchGameEndAt ?? left.capturedAt).getTime();
    const rightTime = (right.matchGameEndAt ?? right.capturedAt).getTime();
    return rightTime - leftTime;
  })[0];
  return record?.rankAfter !== undefined &&
    record.rankAfter !== null &&
    record.rankAfter.length > 0
    ? RankSchema.parse(JSON.parse(record.rankAfter))
    : undefined;
}

function maxRank(
  left: Rank | undefined,
  right: Rank | undefined,
): Rank | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return rankToLeaguePoints(right) > rankToLeaguePoints(left) ? right : left;
}

function parseStoredRank(serialized: string | null): Rank | undefined {
  if (serialized === null || serialized.length === 0) {
    return undefined;
  }
  return RankSchema.parse(JSON.parse(serialized));
}

export async function getHighestRankForPuuidsInWindow(params: {
  prismaClient: ExtendedPrismaClient;
  puuids: LeaguePuuid[];
  queueType: "solo" | "flex";
  startDate: Date;
  endDate: Date;
}): Promise<Rank | undefined> {
  const { prismaClient, puuids, queueType, startDate, endDate } = params;
  if (puuids.length === 0) {
    return undefined;
  }

  const records = await prismaClient.matchRankHistory.findMany({
    where: {
      puuid: { in: puuids },
      queueType,
      OR: [
        { matchGameEndAt: { gte: startDate, lte: endDate } },
        { matchGameEndAt: null, capturedAt: { gte: startDate, lte: endDate } },
      ],
    },
  });

  let highestRank: Rank | undefined;
  for (const record of records) {
    highestRank = maxRank(highestRank, parseStoredRank(record.rankBefore));
    highestRank = maxRank(highestRank, parseStoredRank(record.rankAfter));
  }

  return highestRank;
}

export function getHigherRank(
  left: Rank | undefined,
  right: Rank | undefined,
): Rank | undefined {
  return maxRank(left, right);
}
