import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { linkTreeContents } from "#src/report-lake/link-tree.ts";
import {
  CRAWL_LAKE_TABLE_COLUMNS,
  CRAWL_LAKE_TABLES,
  crawlRetentionCutoffDay,
  INGEST_DAY_PATTERN,
  type CrawlLakeTable,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import {
  crawlManifestIsCurrent,
  emptyCrawlManifest,
  readCrawlManifest,
  writeCrawlManifest,
  type CrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import {
  appendCrawlSegment,
  emptyCrawlSegmentTally,
  type CrawlSegmentTally,
} from "#src/report-lake/crawl/crawl-fold.ts";
import {
  CrawlParquetWriter,
  crawlDayDir,
  sumCrawlRowCounts,
} from "#src/report-lake/crawl/crawl-parquet-writer.ts";
import type { ErasedPuuidHashes } from "#src/report-lake/crawl/crawl-rows.ts";
import type {
  CommittedCrawlSegment,
  CrawlSegmentSource,
} from "#src/report-lake/crawl/crawl-sources.ts";
import { columnList } from "#src/reports/duckdb/lake/column-list.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { PARQUET_COPY_OPTIONS } from "#src/reports/duckdb/writes/parquet.ts";

/**
 * Crawl-table maintenance inside an unpublished build.
 *
 * Every function here edits only the build directory it is given. Builds share
 * unchanged files by hardlink, so a file is replaced by writing a new one and
 * unlinking this build's link to the old one — never rewritten in place,
 * which would change the published build under its readers.
 */

const logger = createLogger("report-lake-crawl-maintenance");
const MAINTENANCE_TIMEOUT_MS = 30 * 60 * 1000;

function withoutDays(
  days: CrawlManifest["days"],
  removed: readonly string[],
): CrawlManifest["days"] {
  return Object.fromEntries(
    Object.entries(days).filter(([day]) => !removed.includes(day)),
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function dayFiles(
  buildDir: string,
  table: CrawlLakeTable,
  day: string,
): Promise<string[]> {
  const directory = crawlDayDir(buildDir, table, day);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".parquet"))
    .map((name) => path.join(directory, name))
    .toSorted();
}

async function removeCrawlDay(buildDir: string, day: string): Promise<void> {
  for (const table of CRAWL_LAKE_TABLES) {
    await rm(crawlDayDir(buildDir, table, day), {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Hardlink the previous build's crawl tables and ledger into `buildDir`.
 * Returns the carried ledger, or undefined when there is nothing current to
 * carry — no crawl data yet, or crawl tables at another crawl schema, which
 * the caller re-derives from raw segments instead.
 */
export async function carryCrawlTables(
  previousDir: string | undefined,
  buildDir: string,
): Promise<CrawlManifest | undefined> {
  if (previousDir === undefined) return undefined;
  const manifest = await readCrawlManifest(previousDir);
  if (manifest === undefined) return undefined;
  if (!crawlManifestIsCurrent(manifest)) {
    logger.info(
      `Previous build's crawl tables are at crawl schema ${manifest.crawlSchemaFingerprint}; re-deriving them from raw segments`,
    );
    return undefined;
  }
  for (const table of CRAWL_LAKE_TABLES) {
    const source = path.join(previousDir, table);
    if (!(await isDirectory(source))) continue;
    await linkTreeContents(source, path.join(buildDir, table));
  }
  await writeCrawlManifest(buildDir, manifest);
  return manifest;
}

/**
 * Re-derive one ingest day's crawl rows from its committed raw segments,
 * replacing whatever the build held for that day. Erased players are dropped
 * as the segments are read. Updates `manifest` in memory; the caller writes it.
 */
export async function rebuildCrawlDay(input: {
  buildDir: string;
  buildId: string;
  day: string;
  manifest: CrawlManifest;
  segments: readonly CommittedCrawlSegment[];
  source: CrawlSegmentSource;
  erased: ErasedPuuidHashes;
  abortSignal?: AbortSignal | undefined;
}): Promise<CrawlSegmentTally> {
  if (!INGEST_DAY_PATTERN.test(input.day)) {
    throw new Error(`Not an ingest day: ${input.day}`);
  }
  await removeCrawlDay(input.buildDir, input.day);
  input.manifest.days = withoutDays(input.manifest.days, [input.day]);
  const tally = emptyCrawlSegmentTally();
  const writer = new CrawlParquetWriter(
    input.buildDir,
    `day-${input.buildId}`,
    input.abortSignal,
  );
  try {
    for (const segment of input.segments) {
      input.abortSignal?.throwIfAborted();
      if (segment.dt !== input.day) {
        throw new Error(
          `Segment ${segment.sha256} belongs to ${segment.dt}, not ${input.day}`,
        );
      }
      await appendCrawlSegment({
        writer,
        manifest: input.manifest,
        tally,
        segment: { ...segment, bytes: await input.source.read(segment) },
        erased: input.erased,
      });
    }
    tally.rows = await writer.finish();
  } finally {
    await writer.abort();
  }
  return tally;
}

const CopyCountSchema = z
  .object({ Count: z.union([z.bigint(), z.number()]) })
  .transform((row) => Number(row.Count));

const MatchIdRowSchema = z.object({ match_id: z.string() });

/**
 * Merge one ingest day's fold fragments into a single file per table, and
 * drop every match that names an erased player. A day already in one file
 * with no erased player is left alone.
 */
export async function compactCrawlDay(input: {
  buildDir: string;
  buildId: string;
  day: string;
  erased: ErasedPuuidHashes;
  abortSignal?: AbortSignal | undefined;
}): Promise<{ compacted: boolean; erasedMatches: number }> {
  const files = new Map<CrawlLakeTable, string[]>();
  for (const table of CRAWL_LAKE_TABLES) {
    files.set(table, await dayFiles(input.buildDir, table, input.day));
  }
  const matchFiles = files.get("matches_crawl") ?? [];
  const fragmented = [...files.values()].some((list) => list.length > 1);
  const erasedHashes = [...input.erased];

  return await withMaintenanceDuckDBConnection(
    async (session) => {
      let erasedMatchIds: string[] = [];
      if (erasedHashes.length > 0 && matchFiles.length > 0) {
        const rows = await session.run(
          `SELECT DISTINCT match_id FROM read_parquet($1, hive_partitioning = false) WHERE puuid IS NOT NULL AND sha256(puuid) IN (SELECT unnest($2))`,
          [session.list(matchFiles), session.list(erasedHashes)],
        );
        erasedMatchIds = rows.map(
          (row) => MatchIdRowSchema.parse(row).match_id,
        );
      }
      if (!fragmented && erasedMatchIds.length === 0) {
        return { compacted: false, erasedMatches: 0 };
      }
      for (const [table, tableFiles] of files) {
        if (tableFiles.length === 0) continue;
        input.abortSignal?.throwIfAborted();
        const directory = crawlDayDir(input.buildDir, table, input.day);
        const staged = path.join(
          input.buildDir,
          `.compact-${table}-${input.day}.parquet`,
        );
        const target = path.join(directory, `compact-${input.buildId}.parquet`);
        const filtered = erasedMatchIds.length > 0;
        const counted = await session.run(
          `COPY (SELECT ${columnList(CRAWL_LAKE_TABLE_COLUMNS[table])} FROM read_parquet($1, hive_partitioning = false)${filtered ? " WHERE match_id NOT IN (SELECT unnest($2))" : ""}) TO '${staged.replaceAll("'", "''")}' (${PARQUET_COPY_OPTIONS})`,
          filtered
            ? [session.list(tableFiles), session.list(erasedMatchIds)]
            : [session.list(tableFiles)],
        );
        const kept = CopyCountSchema.parse(counted[0]);
        for (const file of tableFiles) await rm(file);
        if (kept === 0) {
          await rm(staged);
          await rm(directory, { recursive: true, force: true });
          continue;
        }
        await rename(staged, target);
      }
      return { compacted: true, erasedMatches: erasedMatchIds.length };
    },
    {
      timeoutMs: MAINTENANCE_TIMEOUT_MS,
      ...(input.abortSignal === undefined
        ? {}
        : { abortSignal: input.abortSignal }),
    },
  );
}

/** Drop every ingest day older than the retention window; returns the days dropped. */
export async function applyCrawlRetention(input: {
  buildDir: string;
  manifest: CrawlManifest;
  now: Date;
}): Promise<string[]> {
  const cutoff = crawlRetentionCutoffDay(input.now);
  const dropped = new Set<string>();
  for (const table of CRAWL_LAKE_TABLES) {
    const tableDir = path.join(input.buildDir, table);
    if (!(await isDirectory(tableDir))) continue;
    const names = await readdir(tableDir);
    for (const name of names) {
      const day = name.startsWith("ingest_day=")
        ? name.slice("ingest_day=".length)
        : undefined;
      if (day === undefined || day >= cutoff) continue;
      await rm(path.join(input.buildDir, table, name), {
        recursive: true,
        force: true,
      });
      dropped.add(day);
    }
  }
  const expired = Object.keys(input.manifest.days).filter(
    (day) => day < cutoff,
  );
  input.manifest.days = withoutDays(input.manifest.days, expired);
  for (const day of expired) dropped.add(day);
  return [...dropped].toSorted();
}

export type CrawlMaintenanceSummary = CrawlSegmentTally & {
  carried: boolean;
  rebuiltDays: string[];
  compactedDays: string[];
  expiredDays: string[];
};

/**
 * The nightly rebuild's crawl step, run inside its new build:
 *
 * 1. hardlink the previous build's crawl tables when their crawl schema is
 *    current (otherwise start empty and re-derive every retained day);
 * 2. re-derive any retained day whose ledger lacks a committed segment — an
 *    inbox write that never landed, or a crawl schema change;
 * 3. drop days past retention;
 * 4. compact every completed day still in fold fragments.
 */
export async function maintainCrawlTables(input: {
  previousDir: string | undefined;
  buildDir: string;
  buildId: string;
  source: CrawlSegmentSource;
  erased: ErasedPuuidHashes;
  now: Date;
  abortSignal?: AbortSignal | undefined;
}): Promise<CrawlMaintenanceSummary> {
  const carried = await carryCrawlTables(input.previousDir, input.buildDir);
  const manifest = carried ?? emptyCrawlManifest();
  const summary: CrawlMaintenanceSummary = {
    ...emptyCrawlSegmentTally(),
    carried: carried !== undefined,
    rebuiltDays: [],
    compactedDays: [],
    expiredDays: [],
  };

  const committed = Map.groupBy(
    await input.source.segmentsSince(crawlRetentionCutoffDay(input.now)),
    (segment) => segment.dt,
  );
  for (const [day, segments] of committed) {
    const ledger = new Set(manifest.days[day]);
    if (segments.every((segment) => ledger.has(segment.sha256))) continue;
    const tally = await rebuildCrawlDay({
      buildDir: input.buildDir,
      buildId: input.buildId,
      day,
      manifest,
      segments,
      source: input.source,
      erased: input.erased,
      abortSignal: input.abortSignal,
    });
    summary.rebuiltDays.push(day);
    summary.segments += tally.segments;
    summary.erasedMatches += tally.erasedMatches;
    summary.invalidMatches += tally.invalidMatches;
    summary.rows = sumCrawlRowCounts(summary.rows, tally.rows);
  }

  summary.expiredDays = await applyCrawlRetention({
    buildDir: input.buildDir,
    manifest,
    now: input.now,
  });

  const today = input.now.toISOString().slice(0, 10);
  for (const day of Object.keys(manifest.days).toSorted()) {
    if (day >= today) continue;
    const compaction = await compactCrawlDay({
      buildDir: input.buildDir,
      buildId: input.buildId,
      day,
      erased: input.erased,
      abortSignal: input.abortSignal,
    });
    if (compaction.compacted) summary.compactedDays.push(day);
    summary.erasedMatches += compaction.erasedMatches;
  }

  if (carried !== undefined || Object.keys(manifest.days).length > 0) {
    await writeCrawlManifest(input.buildDir, manifest);
  }
  return summary;
}
