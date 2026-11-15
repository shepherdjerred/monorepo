import { createLogger } from "#src/logger.ts";
import {
  listCrawlInbox,
  type CrawlInboxSegment,
} from "#src/report-lake/crawl/crawl-inbox.ts";
import { crawlRetentionCutoffDay } from "#src/report-lake/crawl/crawl-lake-schema.ts";
import {
  crawlManifestIsCurrent,
  emptyCrawlManifest,
  foldedSegments,
  readCrawlManifest,
  writeCrawlManifest,
  type CrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import {
  CrawlParquetWriter,
  zeroCrawlRowCounts,
  type CrawlRowCounts,
} from "#src/report-lake/crawl/crawl-parquet-writer.ts";
import {
  flattenCrawlRecord,
  readCrawlSegment,
  segmentSha256,
  type ErasedPuuidHashes,
} from "#src/report-lake/crawl/crawl-rows.ts";

const logger = createLogger("report-lake-crawl-fold");

export type CrawlSegmentTally = {
  segments: number;
  erasedMatches: number;
  invalidMatches: number;
  rows: CrawlRowCounts;
};

export type CrawlFoldSummary = CrawlSegmentTally & {
  /**
   * `schema-pending` when the build's crawl tables were written at another
   * crawl schema: the inbox waits for the nightly rebuild to re-derive them,
   * rather than mixing two physical layouts in one directory.
   */
  status: "folded" | "schema-pending";
  /** Inbox files a previous fold already published (removed again now). */
  alreadyFolded: number;
  /** Inbox files for a day retention has already dropped. */
  expired: number;
};

export function emptyCrawlSegmentTally(): CrawlSegmentTally {
  return {
    segments: 0,
    erasedMatches: 0,
    invalidMatches: 0,
    rows: zeroCrawlRowCounts(),
  };
}

/**
 * Decode segments into `writer` and record them in `manifest`, checking every
 * record against the erased-PUUID list. Shared by the inbox fold and a day
 * rebuild so both write the same rows from the same bytes.
 */
export async function appendCrawlSegment(input: {
  writer: CrawlParquetWriter;
  manifest: CrawlManifest;
  tally: CrawlSegmentTally;
  segment: { sha256: string; dt: string; bytes: Uint8Array };
  erased: ErasedPuuidHashes;
}): Promise<void> {
  const { segment } = input;
  const actual = segmentSha256(segment.bytes);
  if (actual !== segment.sha256) {
    throw new Error(
      `Crawl segment ${segment.sha256} does not match its bytes (sha256 ${actual})`,
    );
  }
  const decoded = readCrawlSegment(segment.bytes, input.erased);
  for (const record of decoded.records) {
    await input.writer.add(segment.dt, flattenCrawlRecord(record, segment.dt));
  }
  input.tally.segments += 1;
  input.tally.erasedMatches += decoded.erased;
  input.tally.invalidMatches += decoded.invalid;
  input.manifest.days[segment.dt] = [
    ...(input.manifest.days[segment.dt] ?? []),
    segment.sha256,
  ];
}

/**
 * Fold the crawl inbox into an unpublished build.
 *
 * `buildDir` already holds the published build's crawl tables by hardlink;
 * this appends one set of fold files per (table, ingest day) and a new ledger.
 * It returns the inbox files the caller may delete once the build is
 * published — never before, or a crash between the two would lose them.
 */
export async function foldCrawlInbox(input: {
  lakeDir: string;
  buildDir: string;
  buildId: string;
  /** Read only when the inbox holds something to fold. */
  loadErased: () => Promise<ErasedPuuidHashes>;
  now?: Date;
  abortSignal?: AbortSignal | undefined;
}): Promise<{ summary: CrawlFoldSummary; consumed: CrawlInboxSegment[] }> {
  const summary: CrawlFoldSummary = {
    ...emptyCrawlSegmentTally(),
    status: "folded",
    alreadyFolded: 0,
    expired: 0,
  };
  const inbox = await listCrawlInbox(input.lakeDir);
  if (inbox.length === 0) return { summary, consumed: [] };

  const manifest =
    (await readCrawlManifest(input.buildDir)) ?? emptyCrawlManifest();
  if (!crawlManifestIsCurrent(manifest)) {
    logger.warn(
      `Build crawl tables are at crawl schema ${manifest.crawlSchemaFingerprint}; leaving ${inbox.length.toString()} inbox segments for the nightly rebuild`,
    );
    return { summary: { ...summary, status: "schema-pending" }, consumed: [] };
  }

  const cutoff = crawlRetentionCutoffDay(input.now ?? new Date());
  const already = foldedSegments(manifest);
  const erased = await input.loadErased();
  const consumed: CrawlInboxSegment[] = [];
  const writer = new CrawlParquetWriter(
    input.buildDir,
    `fold-${input.buildId}`,
    input.abortSignal,
  );
  try {
    for (const segment of inbox) {
      input.abortSignal?.throwIfAborted();
      consumed.push(segment);
      if (already.has(segment.sha256)) {
        summary.alreadyFolded += 1;
        continue;
      }
      if (segment.dt < cutoff) {
        summary.expired += 1;
        continue;
      }
      await appendCrawlSegment({
        writer,
        manifest,
        tally: summary,
        segment: { ...segment, bytes: await Bun.file(segment.file).bytes() },
        erased,
      });
    }
    summary.rows = await writer.finish();
  } finally {
    await writer.abort();
  }
  if (summary.segments > 0) {
    await writeCrawlManifest(input.buildDir, manifest);
  }
  return { summary, consumed };
}
