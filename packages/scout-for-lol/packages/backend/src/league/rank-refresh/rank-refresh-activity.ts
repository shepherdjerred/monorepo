import type { ScoutRankRefreshBatchResult } from "@scout-for-lol/temporal/rank-refresh-contracts";
import { scoutRankRefreshEnabled } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { fetchCurrentRanks } from "#src/league/initial-history/riot.ts";
import { createLogger } from "#src/logger.ts";
import { refreshDueRanks, type RankRefreshBatch } from "./rank-refresh.ts";

const logger = createLogger("rank-refresh");

/**
 * One bounded batch of the daily rank refresh, wired to PostgreSQL, the Riot
 * league-entry fetch and the `scout-rank-refresh-enabled` kill switch. The flag
 * is read per batch, so turning it off stops a run at its next batch.
 */
export async function runRankRefreshActivity(
  onProgress: (progress: { done: number; of: number }) => void,
): Promise<ScoutRankRefreshBatchResult> {
  if (!scoutRankRefreshEnabled()) {
    return { enabled: false, refreshed: 0, unranked: 0, more: false };
  }
  const batch: RankRefreshBatch = await refreshDueRanks({
    prisma,
    fetchRanks: fetchCurrentRanks,
    now: () => new Date(),
    onProgress,
  });
  logger.info(
    `rank refresh batch: ${batch.refreshed.toString()} ranked, ${batch.unranked.toString()} unranked, more=${batch.more.toString()}`,
  );
  return { enabled: true, ...batch };
}
