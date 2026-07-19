#!/usr/bin/env bun
/**
 * Rebuild-parity gate for the S3-canonical pivot (Part 3, PR-A).
 *
 * Before the destructive table drop (PR-B) we must prove the new S3-sourced
 * lake rebuild produces the same result as the legacy SQLite-sourced one. This
 * script rebuilds the lake twice into throwaway dirs — once from the SQLite
 * Stored* tables (`runReportLakeRebuildFromSqlite`) and once from S3
 * (`runReportLakeRebuild`) — then compares both the build summaries (counts)
 * AND the actual generated row CONTENT (a bidirectional DuckDB EXCEPT over the
 * two builds' Parquet). Counts alone are not enough: a stale, corrupted, or
 * wrong-keyed S3 object can flatten to the same number of rows and slip past a
 * count-only gate, and this gate authorizes an irreversible table drop.
 *
 * Expectations:
 *   - MATCH rows must be IDENTICAL in count AND content. Match `month` derives
 *     from gameCreation (in the raw JSON), so every column agrees exactly —
 *     the content comparison includes `month`.
 *   - PREMATCH row COUNT must be identical, and content must match too, EXCEPT
 *     the `month`/`observed_at` columns: both derive from the S3 object's
 *     LastModified (not a stored column), which can cross a midnight UTC
 *     boundary vs the old column, so rows may shift between month partitions.
 *     That drift is by design; the content comparison excludes those two
 *     columns and compares everything else.
 *   - Skipped (unparseable) counts must match.
 *
 * Exits non-zero if counts differ OR the row content diverges.
 *
 * Usage: bun run scripts/report-lake-rebuild-parity.ts
 * Requires the backend pod env (DATABASE_URL, S3_BUCKET_NAME, AWS_*). Run via
 * `kubectl exec` into a scout-{beta,prod} backend pod while the tables exist.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  runReportLakeRebuild,
  runReportLakeRebuildFromSqlite,
} from "#src/report-lake/compactor.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";

const logger = createLogger("report-lake-rebuild-parity");

// Content comparison enumerates every lake row through DuckDB; give it the same
// generous ceiling the compactor uses for a full rebuild.
const CONTENT_DIFF_TIMEOUT_MS = 30 * 60 * 1000;

const DiffCountSchema = z.object({
  sqlite_only: z.union([z.number(), z.bigint()]),
  s3_only: z.union([z.number(), z.bigint()]),
});

function toCount(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function tableParquetGlob(
  buildDir: string,
  table: "matches" | "prematch",
): string {
  return path.join(buildDir, table, "**", "*.parquet");
}

/**
 * Bidirectional content diff of one lake table between the two rebuilds via
 * DuckDB `EXCEPT`. `excludeColumns` drops columns that legitimately differ by
 * design (prematch `month`/`observed_at`). Column names are our own schema
 * literals, never user input, so embedding them in SQL is safe; the two Parquet
 * globs are bound parameters. Returns rows present in one rebuild but not the
 * other, each direction.
 */
async function diffTableContents(
  session: DuckDBSession,
  sqliteGlob: string,
  s3Glob: string,
  excludeColumns: readonly string[],
): Promise<{ sqliteOnly: number; s3Only: number }> {
  const projection =
    excludeColumns.length === 0
      ? "*"
      : `* EXCLUDE (${excludeColumns.join(", ")})`;
  const rows = await session.run(
    `SELECT
       (SELECT count(*) FROM (SELECT ${projection} FROM read_parquet($1) EXCEPT SELECT ${projection} FROM read_parquet($2))) AS sqlite_only,
       (SELECT count(*) FROM (SELECT ${projection} FROM read_parquet($2) EXCEPT SELECT ${projection} FROM read_parquet($1))) AS s3_only`,
    [sqliteGlob, s3Glob],
  );
  const parsed = z.array(DiffCountSchema).parse(rows);
  const row = parsed[0];
  if (row === undefined) {
    throw new Error("content diff query returned no rows");
  }
  return {
    sqliteOnly: toCount(row.sqlite_only),
    s3Only: toCount(row.s3_only),
  };
}

/** A few example match_ids whose rows differ, to make a failure actionable. */
async function sampleDifferingMatchIds(
  session: DuckDBSession,
  sqliteGlob: string,
  s3Glob: string,
): Promise<string[]> {
  const rows = await session.run(
    `SELECT DISTINCT match_id FROM (
       (SELECT * FROM read_parquet($1) EXCEPT SELECT * FROM read_parquet($2))
       UNION ALL
       (SELECT * FROM read_parquet($2) EXCEPT SELECT * FROM read_parquet($1))
     ) ORDER BY match_id LIMIT 10`,
    [sqliteGlob, s3Glob],
  );
  return z
    .array(z.object({ match_id: z.string() }))
    .parse(rows)
    .map((entry) => entry.match_id);
}

const sqliteDir = await mkdtemp(path.join(tmpdir(), "lake-parity-sqlite-"));
const s3Dir = await mkdtemp(path.join(tmpdir(), "lake-parity-s3-"));

try {
  logger.info("Rebuilding lake from SQLite Stored* tables...", { sqliteDir });
  const sqlite = await runReportLakeRebuildFromSqlite({ lakeDir: sqliteDir });
  logger.info("Rebuilding lake from S3...", { s3Dir });
  const s3 = await runReportLakeRebuild({ lakeDir: s3Dir });

  if (sqlite === null || s3 === null) {
    throw new Error(
      "A rebuild returned null (another compaction held the lock). Retry.",
    );
  }

  logger.info("Parity summary", {
    matchRows: { sqlite: sqlite.matchRows, s3: s3.matchRows },
    prematchRows: { sqlite: sqlite.prematchRows, s3: s3.prematchRows },
    skippedMatches: { sqlite: sqlite.skippedMatches, s3: s3.skippedMatches },
    skippedPrematches: {
      sqlite: sqlite.skippedPrematches,
      s3: s3.skippedPrematches,
    },
  });

  const problems: string[] = [];
  if (sqlite.matchRows !== s3.matchRows) {
    problems.push(
      `match rows differ: sqlite=${sqlite.matchRows.toString()} s3=${s3.matchRows.toString()} (S3 is missing matches — run the backfill gate first)`,
    );
  }
  if (sqlite.skippedMatches !== s3.skippedMatches) {
    problems.push(
      `skipped-match counts differ: sqlite=${sqlite.skippedMatches.toString()} s3=${s3.skippedMatches.toString()}`,
    );
  }
  if (sqlite.prematchRows !== s3.prematchRows) {
    problems.push(
      `prematch row counts differ: sqlite=${sqlite.prematchRows.toString()} s3=${s3.prematchRows.toString()} (a count mismatch is a real gap, not month drift)`,
    );
  }

  // Content parity — the load-bearing check before the irreversible drop.
  // Equal counts do not prove equal data: compare the actual generated rows.
  // Only runs per table when BOTH rebuilds produced rows (a rebuild writes no
  // Parquet for an empty table, so the glob would have nothing to read — the
  // count check above already flags a one-sided emptiness).
  const sqliteBuildDir = await readCurrentBuildDir(sqliteDir);
  const s3BuildDir = await readCurrentBuildDir(s3Dir);
  if (sqliteBuildDir === undefined || s3BuildDir === undefined) {
    throw new Error(
      "A rebuild published no CURRENT build dir — cannot compare row content.",
    );
  }
  await withDuckDBConnection(
    async (session) => {
      if (sqlite.matchRows > 0 && s3.matchRows > 0) {
        const matchDiff = await diffTableContents(
          session,
          tableParquetGlob(sqliteBuildDir, "matches"),
          tableParquetGlob(s3BuildDir, "matches"),
          [],
        );
        if (matchDiff.sqliteOnly > 0 || matchDiff.s3Only > 0) {
          const samples = await sampleDifferingMatchIds(
            session,
            tableParquetGlob(sqliteBuildDir, "matches"),
            tableParquetGlob(s3BuildDir, "matches"),
          );
          problems.push(
            `match row CONTENT differs: ${matchDiff.sqliteOnly.toString()} row(s) only in the SQLite rebuild, ${matchDiff.s3Only.toString()} only in S3 (equal counts can still hide stale/corrupted/wrong-keyed S3 objects). Sample match_ids: ${samples.join(", ")}`,
          );
        }
      }
      if (sqlite.prematchRows > 0 && s3.prematchRows > 0) {
        const prematchDiff = await diffTableContents(
          session,
          tableParquetGlob(sqliteBuildDir, "prematch"),
          tableParquetGlob(s3BuildDir, "prematch"),
          ["month", "observed_at"],
        );
        if (prematchDiff.sqliteOnly > 0 || prematchDiff.s3Only > 0) {
          problems.push(
            `prematch row CONTENT differs (ignoring by-design month/observed_at drift): ${prematchDiff.sqliteOnly.toString()} row(s) only in the SQLite rebuild, ${prematchDiff.s3Only.toString()} only in S3`,
          );
        }
      }
    },
    { timeoutMs: CONTENT_DIFF_TIMEOUT_MS },
  );

  if (problems.length > 0) {
    for (const problem of problems) {
      logger.error(`❌ ${problem}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  logger.info(
    "✅ Parity OK — S3 rebuild matches the SQLite rebuild in count AND content (match rows byte-identical; prematch content identical except by-design month/observed_at partition drift).",
  );
} finally {
  await prisma.$disconnect();
  await rm(sqliteDir, { recursive: true, force: true });
  await rm(s3Dir, { recursive: true, force: true });
}
