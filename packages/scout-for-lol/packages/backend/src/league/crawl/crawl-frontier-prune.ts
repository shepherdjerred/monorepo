import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { CRAWL_MAX_DEPTH } from "./crawl-config.ts";

/**
 * Bounds the crawl's work queue. `CrawlFrontier` gains about nine rows for every
 * match the crawl stores, but the crawl visits only a few players a minute, so
 * almost every row waits unclaimed. Crawled matches (`CrawlMatch`, the raw
 * segments) are the permanent record; a frontier row exists only to schedule a
 * future visit, and a pruned player is admitted again whenever a later crawled
 * match names them.
 *
 * Two rules, both run by the Schedule-driven `scoutCrawlFrontierPruneWorkflow`:
 *
 * - **Stale.** A row still unclaimed `CRAWL_FRONTIER_STALE_DAYS` after it became
 *   eligible is dropped. A visited player whose revisit never came reaches this
 *   too: `nextEligibleAt` is then the end of their cooldown, long past.
 * - **Backlog.** Each depth keeps only its newest `backlogCap` unvisited rows.
 *   The claim visits the oldest eligible row of the shallowest depth, so the
 *   rows beyond the cap are the ones the crawl would reach last; dropping the
 *   oldest keeps the crawl on the players surfaced most recently, whose last 28
 *   days of matches are the most likely to be new.
 *
 * Deletes run in bounded batches that lock only the rows they remove and skip
 * rows a crawl commit holds, so neither side waits on or deadlocks with the
 * other.
 */

/** A row unclaimed this long after it became eligible is dropped: the 28-day lookback (pinned by a test). */
export const CRAWL_FRONTIER_STALE_DAYS = 28;

/**
 * Each depth keeps this many days of the daily match budget as unvisited rows,
 * counting one match per visit: a conservative floor, because a visit stores
 * about twenty matches on a fresh frontier and a few at saturation.
 */
export const CRAWL_FRONTIER_BACKLOG_DAYS = 3;

/** The smallest backlog a depth keeps, whatever the budget. */
export const CRAWL_FRONTIER_MIN_BACKLOG = 20_000;

/** Rows one prune batch deletes at most. */
export const CRAWL_FRONTIER_PRUNE_BATCH = 2000;

const DAY_MS = 86_400_000;

/** Unvisited rows each depth may hold for a crawl that stores `dailyMatchBudget` matches a day. */
export function crawlFrontierBacklogCap(dailyMatchBudget: number): number {
  return Math.max(
    CRAWL_FRONTIER_MIN_BACKLOG,
    dailyMatchBudget * CRAWL_FRONTIER_BACKLOG_DAYS,
  );
}

export type FrontierPruneInput = {
  now: Date;
  /** Rows this call may delete at most, across both rules. */
  batchSize: number;
  /** Unvisited rows each depth keeps. */
  backlogCap: number;
};

export type FrontierPruneResult = {
  stale: number;
  overflow: number;
  /** The batch was full, so more rows may be waiting. */
  more: boolean;
};

const CutoffRowsSchema = z.array(z.object({ nextEligibleAt: z.date() }));

/** Delete up to `limit` rows of `depth` unclaimed since before `cutoff`, oldest first. */
async function deleteStale(
  prisma: ExtendedPrismaClient,
  depth: number,
  cutoff: Date,
  limit: number,
): Promise<number> {
  return await prisma.$executeRaw`
    DELETE FROM "CrawlFrontier" WHERE "puuid" IN (
      SELECT "puuid" FROM "CrawlFrontier"
      WHERE "depth" = ${depth} AND "nextEligibleAt" < ${cutoff}
      ORDER BY "nextEligibleAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )`;
}

/**
 * Delete up to `limit` unvisited rows of `depth` that are older than the
 * newest `backlogCap`. Rows sharing the boundary timestamp go too, so a depth
 * may sit a few rows under the cap, never over it.
 */
async function deleteOverflow(
  prisma: ExtendedPrismaClient,
  depth: number,
  backlogCap: number,
  limit: number,
): Promise<number> {
  const boundary = CutoffRowsSchema.parse(
    await prisma.$queryRaw`
      SELECT "nextEligibleAt" FROM "CrawlFrontier"
      WHERE "depth" = ${depth} AND "lastVisitedAt" IS NULL
      ORDER BY "nextEligibleAt" DESC
      OFFSET ${backlogCap}
      LIMIT 1`,
  )[0];
  if (boundary === undefined) return 0;
  return await prisma.$executeRaw`
    DELETE FROM "CrawlFrontier" WHERE "puuid" IN (
      SELECT "puuid" FROM "CrawlFrontier"
      WHERE "depth" = ${depth} AND "lastVisitedAt" IS NULL
        AND "nextEligibleAt" <= ${boundary.nextEligibleAt}
      ORDER BY "nextEligibleAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )`;
}

/** One bounded batch of pruning: stale rows first, then each depth's backlog overflow. */
export async function pruneCrawlFrontierBatch(
  prisma: ExtendedPrismaClient,
  input: FrontierPruneInput,
): Promise<FrontierPruneResult> {
  const cutoff = new Date(
    input.now.getTime() - CRAWL_FRONTIER_STALE_DAYS * DAY_MS,
  );
  let remaining = input.batchSize;
  let stale = 0;
  let overflow = 0;
  for (let depth = 0; depth <= CRAWL_MAX_DEPTH && remaining > 0; depth += 1) {
    const deleted = await deleteStale(prisma, depth, cutoff, remaining);
    stale += deleted;
    remaining -= deleted;
  }
  for (let depth = 0; depth <= CRAWL_MAX_DEPTH && remaining > 0; depth += 1) {
    const deleted = await deleteOverflow(
      prisma,
      depth,
      input.backlogCap,
      remaining,
    );
    overflow += deleted;
    remaining -= deleted;
  }
  return { stale, overflow, more: remaining === 0 };
}
