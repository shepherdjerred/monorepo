import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  applySegmentReplacements,
  eraseCrawlMatchesInBuild,
  type CrawlLakeErasureSummary,
} from "#src/report-lake/crawl/crawl-lake-erasure.ts";
import {
  crawlManifestIsCurrent,
  readCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import {
  runRawErasureSweep,
  type RawErasureObjects,
  type RawErasureSummary,
} from "#src/report-lake/crawl/crawl-raw-erasure.ts";
import { createPrismaRawErasureStore } from "#src/report-lake/crawl/crawl-raw-erasure-store.ts";

/**
 * The durable half of a crawl erasure, run inside every lake fold and nightly
 * rebuild (the `scoutReportLakeWorkflow` Schedules on the lake queue), after
 * the crawl inbox is folded and before the build is published:
 *
 * 1. sweep raw segments for every erasure whose sweep is unfinished, up to a
 *    segment budget per run, resuming from each erasure's saved cursor;
 * 2. rewrite this build's crawl-table files without every match that names a
 *    player whose lake erasure is unfinished;
 * 3. point the build's ledger at the rewritten segments.
 *
 * After the caller publishes, `markPublished` records `lakeErasedAt` for the
 * hashes step 2 removed, which ends their query-time tombstone. The hashes are
 * read before anything else, so an erasure recorded mid-run stays tombstoned
 * until the next run erases it.
 *
 * Every write is checked again at segment write, fold, day rebuild and
 * compaction, so nothing this step removed comes back.
 */

const logger = createLogger("report-lake-crawl-erasure");

/** A fold runs every 15 minutes and must stay quick; the nightly rebuild takes more. */
export const FOLD_RAW_ERASURE_SEGMENT_BUDGET = 500;
export const REBUILD_RAW_ERASURE_SEGMENT_BUDGET = 10_000;

export type CrawlErasureStepSummary = {
  raw: RawErasureSummary | undefined;
  lake: CrawlLakeErasureSummary | undefined;
  ledgerReplacements: number;
  /** Hashes whose lake erasure `markPublished` will record. */
  lakeErased: string[];
};

export async function runCrawlErasureStep(input: {
  prisma: ExtendedPrismaClient;
  buildDir: string;
  buildId: string;
  segmentBudget: number;
  /** Built only when raw work is pending, so a lake without erasures needs no S3. */
  objects: () => RawErasureObjects;
  abortSignal?: AbortSignal | undefined;
}): Promise<{
  summary: CrawlErasureStepSummary;
  markPublished: () => Promise<void>;
}> {
  const { prisma } = input;
  const lakeRows = await prisma.erasedPuuid.findMany({
    where: { lakeErasedAt: null },
    select: { puuidHash: true },
  });
  const lakePending = lakeRows.map((row) => row.puuidHash);
  const rawWork =
    (await prisma.erasedPuuid.count({ where: { rawSweptAt: null } })) +
    (await prisma.crawlObjectDeletion.count());

  const raw =
    rawWork === 0
      ? undefined
      : await runRawErasureSweep({
          store: createPrismaRawErasureStore(prisma),
          objects: input.objects(),
          segmentBudget: input.segmentBudget,
          abortSignal: input.abortSignal,
        });

  const manifest = await readCrawlManifest(input.buildDir);
  // A build at another crawl schema is not read by any query (its files are
  // not listed) and the nightly rebuild re-derives it from erased raw
  // segments, so its erasure waits for that rebuild.
  const stale = manifest !== undefined && !crawlManifestIsCurrent(manifest);
  let lake: CrawlLakeErasureSummary | undefined;
  let ledgerReplacements = 0;
  if (!stale) {
    lake = await eraseCrawlMatchesInBuild({
      buildDir: input.buildDir,
      buildId: input.buildId,
      erased: new Set(lakePending),
      abortSignal: input.abortSignal,
    });
    ledgerReplacements = await applySegmentReplacements(
      input.buildDir,
      raw?.replacements ?? [],
    );
  }
  const summary: CrawlErasureStepSummary = {
    raw,
    lake,
    ledgerReplacements,
    lakeErased: stale ? [] : lakePending,
  };
  if (raw !== undefined || lakePending.length > 0) {
    logger.info(
      `Crawl erasure: ${raw?.segmentsChecked.toString() ?? "0"} raw segments checked, ${raw?.segmentsRewritten.toString() ?? "0"} rewritten, ${lake?.matchesRemoved.toString() ?? "0"} lake matches removed, ${summary.lakeErased.length.toString()} erasures complete in this build${stale ? " (crawl schema pending; waiting for the nightly rebuild)" : ""}`,
    );
  }
  return {
    summary,
    markPublished: async () => {
      if (summary.lakeErased.length === 0) return;
      await prisma.erasedPuuid.updateMany({
        where: { puuidHash: { in: summary.lakeErased }, lakeErasedAt: null },
        data: { lakeErasedAt: new Date() },
      });
    },
  };
}
