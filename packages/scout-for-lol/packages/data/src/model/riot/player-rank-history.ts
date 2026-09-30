import { z } from "zod";
import {
  EARLIER_RANKED_SPLIT_ID,
  getCurrentRankedSplit,
  rankedSplitForTimestamp,
} from "#src/seasons.ts";
import {
  rankToChartPoints,
  tierToOrdinal,
} from "#src/model/riot/league-points.ts";
import {
  RankSchema,
  RankedQueueTypeSchema,
  type Rank,
  type RankedQueueType,
} from "#src/model/riot/rank.ts";

export const RANKED_HISTORY_QUEUES = RankedQueueTypeSchema.options;

export const RankHistoryPointSchema = z.strictObject({
  at: z.date(),
  leaguePoints: z.number(),
  rank: RankSchema,
});
export type RankHistoryPoint = z.infer<typeof RankHistoryPointSchema>;

export const RankHistorySeriesSchema = z.strictObject({
  accountLabel: z.string().min(1),
  points: z.array(RankHistoryPointSchema),
});
export type RankHistorySeries = z.infer<typeof RankHistorySeriesSchema>;

export const PreviousSplitRankSchema = z.strictObject({
  splitId: z.string().min(1),
  displayName: z.string().min(1),
  peak: RankSchema,
  last: RankSchema,
});
export type PreviousSplitRank = z.infer<typeof PreviousSplitRankSchema>;

export const QueueRankHistorySchema = z.strictObject({
  series: z.array(RankHistorySeriesSchema),
  previous: z.array(PreviousSplitRankSchema),
});
export type QueueRankHistory = z.infer<typeof QueueRankHistorySchema>;

export const PlayerRankHistorySchema = z.strictObject({
  currentSplit: z.strictObject({
    id: z.string().min(1),
    displayName: z.string().min(1),
    start: z.date(),
    end: z.date(),
  }),
  queues: z.strictObject({
    solo: QueueRankHistorySchema,
    flex: QueueRankHistorySchema,
    "ranked 5s": QueueRankHistorySchema,
  }),
});
export type PlayerRankHistory = z.infer<typeof PlayerRankHistorySchema>;

export type RankHistoryAccount = {
  puuid: string;
  label: string;
};

export type RankHistoryObservation = {
  puuid: string;
  queue: RankedQueueType;
  at: Date;
  rank: Rank;
  rankBefore?: Rank;
};

export function buildPlayerRankHistory(input: {
  now: Date;
  accounts: readonly RankHistoryAccount[];
  observations: readonly RankHistoryObservation[];
}): PlayerRankHistory {
  const current = getCurrentRankedSplit(input.now);
  const graphEnd =
    input.now.getTime() > current.endDate.getTime()
      ? input.now
      : current.endDate;
  const byQueue = {
    solo: emptyQueue(),
    flex: emptyQueue(),
    "ranked 5s": emptyQueue(),
  } satisfies Record<RankedQueueType, QueueAccumulator>;

  const accountByPuuid = new Map(
    input.accounts.map((account) => [account.puuid, account]),
  );

  for (const observation of input.observations) {
    const account = accountByPuuid.get(observation.puuid);
    if (account === undefined) {
      throw new Error(
        `Rank history observation referenced unrequested PUUID ${observation.puuid}`,
      );
    }
    const split = rankedSplitForTimestamp(observation.at);
    const queue = byQueue[observation.queue];
    if (split.id === current.id) {
      let series = queue.seriesByPuuid.get(observation.puuid);
      if (series === undefined) {
        series = { accountLabel: account.label, points: [] };
        queue.seriesByPuuid.set(observation.puuid, series);
      }
      series.points.push({
        at: observation.at,
        leaguePoints: rankToChartPoints(observation.rank),
        rank: observation.rank,
      });
      continue;
    }
    const previous = queue.previousBySplit.get(split.id) ?? {
      splitId: split.id,
      displayName: split.displayName,
      peak: observation.rank,
      last: observation.rank,
      lastAt: observation.at.getTime(),
    };
    previous.peak = higherRank(previous.peak, observation.rank);
    if (observation.at.getTime() >= previous.lastAt) {
      previous.last = observation.rank;
      previous.lastAt = observation.at.getTime();
    }
    queue.previousBySplit.set(split.id, previous);
  }

  return PlayerRankHistorySchema.parse({
    currentSplit: {
      id: current.id,
      displayName: current.displayName,
      start: current.startDate,
      end: graphEnd,
    },
    queues: {
      solo: finishQueue(byQueue.solo),
      flex: finishQueue(byQueue.flex),
      "ranked 5s": finishQueue(byQueue["ranked 5s"]),
    },
  });
}

type QueueAccumulator = {
  seriesByPuuid: Map<string, RankHistorySeries>;
  previousBySplit: Map<string, PreviousSplitRank & { lastAt: number }>;
};

function emptyQueue(): QueueAccumulator {
  return { seriesByPuuid: new Map(), previousBySplit: new Map() };
}

function finishQueue(queue: QueueAccumulator): QueueRankHistory {
  const series = [...queue.seriesByPuuid.values()].map((entry) => ({
    accountLabel: entry.accountLabel,
    points: entry.points.toSorted(
      (left, right) => left.at.getTime() - right.at.getTime(),
    ),
  }));
  const previous = [...queue.previousBySplit.values()]
    .map((row) => ({
      splitId: row.splitId,
      displayName: row.displayName,
      peak: row.peak,
      last: row.last,
    }))
    .toSorted((left, right) => {
      if (left.splitId === EARLIER_RANKED_SPLIT_ID) return 1;
      return right.splitId === EARLIER_RANKED_SPLIT_ID
        ? -1
        : right.splitId.localeCompare(left.splitId);
    });
  return { series, previous };
}

function higherRank(left: Rank, right: Rank): Rank {
  const tier = tierToOrdinal(right.tier) - tierToOrdinal(left.tier);
  if (tier !== 0) {
    return tier > 0 ? right : left;
  }
  if (left.division !== right.division) {
    return right.division < left.division ? right : left;
  }
  return right.lp > left.lp ? right : left;
}
