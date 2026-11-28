import type {
  ScoutRankRefreshBatchInput,
  ScoutRankRefreshBatchResult,
} from "@scout-for-lol/temporal/rank-refresh-contracts";
import { scoutRankRefreshEnabled } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { fetchCurrentRanks } from "#src/league/initial-history/riot.ts";
import { createLogger } from "#src/logger.ts";
import { refreshDueRanks } from "./rank-refresh.ts";

const logger = createLogger("rank-refresh");

/**
 * One bounded batch of the daily rank refresh, wired to PostgreSQL, the Riot
 * league-entry fetch and the `scout-rank-refresh-enabled` kill switch. The flag
 * is read per batch, so turning it off stops a run at its next batch.
 */
export async function runRankRefreshActivity(
  input: ScoutRankRefreshBatchInput,
  onProgress: (progress: { done: number; of: number }) => void,
): Promise<ScoutRankRefreshBatchResult> {
  if (!scoutRankRefreshEnabled()) {
    return {
      enabled: false,
      refreshed: 0,
      unranked: 0,
      failed: [],
      more: false,
    };
  }
  const batch = await refreshDueRanks({
    prisma,
    fetchRanks: fetchCurrentRanks,
    now: () => new Date(),
    onProgress,
    excluded: input.excluded,
  });
  logger.info(
    `rank refresh batch: ${batch.refreshed.toString()} ranked, ${batch.unranked.toString()} unranked, ${batch.failed.length.toString()} rejected, more=${batch.more.toString()}`,
  );
  return { enabled: true, ...batch };
}
