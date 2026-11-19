import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CRAWL_LAKE_TABLE_COLUMNS,
  CRAWL_LAKE_TABLES,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import {
  readCrawlManifest,
  writeCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import type { SegmentReplacement } from "#src/report-lake/crawl/crawl-raw-erasure.ts";
import type { ErasedPuuidHashes } from "#src/report-lake/crawl/crawl-rows.ts";
import { columnList } from "#src/reports/duckdb/lake/column-list.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { PARQUET_COPY_OPTIONS } from "#src/reports/duckdb/writes/parquet.ts";

/**
 * Erasure inside an unpublished build: every crawl-table file that holds a
 * match naming an erased player is rewritten without that match.
 *
 * Only those files change. Each is replaced by writing a new file and
 * renaming it over this build's hardlink, so the published build keeps its
 * own copy until this one is published, and every other file stays the same
 * inode. A rewritten file keeps every other row, in order, with the table's
 * column list. Running it again finds no erased match and changes nothing.
 */

const ERASURE_TIMEOUT_MS = 30 * 60 * 1000;

const MatchIdRowSchema = z.object({ match_id: z.string() });
const FileRowSchema = z.object({ filename: z.string() });
const CopyCountSchema = z
  .object({ Count: z.union([z.bigint(), z.number()]) })
  .transform((row) => Number(row.Count));

function tableFiles(buildDir: string, table: string): string[] {
  return [
    ...new Bun.Glob(`${table}/ingest_day=*/*.parquet`).scanSync({
      cwd: buildDir,
      absolute: true,
    }),
  ].toSorted();
}

export type CrawlLakeErasureSummary = {
  matchesRemoved: number;
  filesRewritten: number;
  filesRemoved: number;
  /** Ingest days a file was rewritten or removed in; their partials are stale. */
  daysTouched: string[];
};

export async function eraseCrawlMatchesInBuild(input: {
  buildDir: string;
  buildId: string;
  erased: ErasedPuuidHashes;
  abortSignal?: AbortSignal | undefined;
}): Promise<CrawlLakeErasureSummary> {
  const summary: CrawlLakeErasureSummary = {
    matchesRemoved: 0,
    filesRewritten: 0,
    filesRemoved: 0,
    daysTouched: [],
  };
  const touched = new Set<string>();
  const matchFiles = tableFiles(input.buildDir, "matches_crawl");
  if (input.erased.size === 0 || matchFiles.length === 0) return summary;
  return await withMaintenanceDuckDBConnection(
    async (session) => {
      const erasedRows = await session.run(
        `SELECT DISTINCT match_id FROM read_parquet($1, hive_partitioning = false) WHERE puuid IS NOT NULL AND sha256(puuid) IN (SELECT unnest($2))`,
        [session.list(matchFiles), session.list([...input.erased])],
      );
      const matchIds = erasedRows.map(
        (row) => MatchIdRowSchema.parse(row).match_id,
      );
      summary.matchesRemoved = matchIds.length;
      if (matchIds.length === 0) return summary;
      for (const table of CRAWL_LAKE_TABLES) {
        const files = tableFiles(input.buildDir, table);
        if (files.length === 0) continue;
        input.abortSignal?.throwIfAborted();
        const holding = await session.run(
          `SELECT DISTINCT filename FROM read_parquet($1, hive_partitioning = false, filename = true) WHERE match_id IN (SELECT unnest($2)) ORDER BY filename`,
          [session.list(files), session.list(matchIds)],
        );
        for (const row of holding) {
          input.abortSignal?.throwIfAborted();
          const file = FileRowSchema.parse(row).filename;
          const day = /ingest_day=(\d{4}-\d{2}-\d{2})\//u.exec(file)?.[1];
          if (day !== undefined) touched.add(day);
          const staged = path.join(
            input.buildDir,
            `.erase-${input.buildId}-${path.basename(file)}`,
          );
          const counted = await session.run(
            `COPY (SELECT ${columnList(CRAWL_LAKE_TABLE_COLUMNS[table])} FROM read_parquet($1, hive_partitioning = false) WHERE match_id NOT IN (SELECT unnest($2))) TO '${staged.replaceAll("'", "''")}' (${PARQUET_COPY_OPTIONS})`,
            [file, session.list(matchIds)],
          );
          if (CopyCountSchema.parse(counted[0]) === 0) {
            await rm(staged);
            await rm(file);
            summary.filesRemoved += 1;
          } else {
            await rename(staged, file);
            summary.filesRewritten += 1;
          }
        }
      }
      summary.daysTouched = [...touched].toSorted();
      return summary;
    },
    {
      timeoutMs: ERASURE_TIMEOUT_MS,
      ...(input.abortSignal === undefined
        ? {}
        : { abortSignal: input.abortSignal }),
    },
  );
}

/**
 * Point the build's crawl ledger at the raw segments the sweep wrote in place
 * of the ones it read, so the nightly rebuild does not re-derive those days.
 * Valid only for a build whose crawl tables were erased with every hash the
 * sweep used: the rewritten segment then yields exactly the rows the build
 * still holds. A replacement the ledger does not list is left alone; the
 * nightly rebuild re-derives that day from the committed segments.
 */
export async function applySegmentReplacements(
  buildDir: string,
  replacements: readonly SegmentReplacement[],
): Promise<number> {
  if (replacements.length === 0) return 0;
  const manifest = await readCrawlManifest(buildDir);
  if (manifest === undefined) return 0;
  let applied = 0;
  for (const replacement of replacements) {
    const listed = manifest.days[replacement.dt];
    if (listed?.includes(replacement.oldSha256) !== true) continue;
    manifest.days[replacement.dt] = [
      ...listed.filter((sha) => sha !== replacement.oldSha256),
      ...(replacement.newSha256 === null ? [] : [replacement.newSha256]),
    ];
    applied += 1;
  }
  if (applied > 0) await writeCrawlManifest(buildDir, manifest);
  return applied;
}
