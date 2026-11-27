import { participantCrawlDailyMatchBudget } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { crawlFrontierPrunedTotal } from "#src/metrics/crawl-frontier.ts";
import {
  CRAWL_FRONTIER_PRUNE_BATCH,
  crawlFrontierBacklogCap,
  pruneCrawlFrontierBatch,
  type FrontierPruneResult,
} from "./crawl-frontier-prune.ts";

/**
 * One bounded batch of frontier pruning, wired to PostgreSQL and the crawl's
 * daily match budget (which sizes the backlog it keeps). It runs whether or
 * not the crawl is enabled: a switched-off crawl still holds rows to age out.
 */
export async function runCrawlFrontierPruneActivity(): Promise<FrontierPruneResult> {
  const result = await pruneCrawlFrontierBatch(prisma, {
    now: new Date(),
    batchSize: CRAWL_FRONTIER_PRUNE_BATCH,
    backlogCap: crawlFrontierBacklogCap(participantCrawlDailyMatchBudget()),
  });
  crawlFrontierPrunedTotal.inc({ reason: "stale" }, result.stale);
  crawlFrontierPrunedTotal.inc({ reason: "overflow" }, result.overflow);
  return result;
}
