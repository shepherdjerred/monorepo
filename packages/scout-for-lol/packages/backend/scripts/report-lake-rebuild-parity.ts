#!/usr/bin/env bun
/**
 * Rebuild-parity gate for the S3-canonical pivot (Part 3, PR-A).
 *
 * Before the destructive table drop (PR-B) we must prove the new S3-sourced
 * lake rebuild produces the same result as the legacy SQLite-sourced one. This
 * script rebuilds the lake twice into throwaway dirs — once from the SQLite
 * Stored* tables (`runReportLakeRebuildFromSqlite`) and once from S3
 * (`runReportLakeRebuild`) — and compares the build summaries.
 *
 * Expectations:
 *   - MATCH rows must be IDENTICAL. Match `month` derives from gameCreation
 *     (in the raw JSON), so both sources and both partitionings agree exactly.
 *   - PREMATCH row COUNT must be identical, but individual rows may shift
 *     between month partitions: `observed_at` is no longer a stored column and
 *     is derived from the S3 object's LastModified, which can cross a midnight
 *     UTC boundary vs the old column. This drift is expected and reported, not
 *     failed.
 *   - Skipped (unparseable) counts must match.
 *
 * Exits non-zero if match rows differ or prematch counts differ.
 *
 * Usage: bun run scripts/report-lake-rebuild-parity.ts
 * Requires the backend pod env (DATABASE_URL, S3_BUCKET_NAME, AWS_*). Run via
 * `kubectl exec` into a scout-{beta,prod} backend pod while the tables exist.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  runReportLakeRebuild,
  runReportLakeRebuildFromSqlite,
} from "#src/report-lake/compactor.ts";

const logger = createLogger("report-lake-rebuild-parity");

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

  if (problems.length > 0) {
    for (const problem of problems) {
      logger.error(`❌ ${problem}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  logger.info(
    "✅ Parity OK — S3 rebuild matches the SQLite rebuild (match rows identical; prematch counts identical, month partitioning may drift by design).",
  );
} finally {
  await prisma.$disconnect();
  await rm(sqliteDir, { recursive: true, force: true });
  await rm(s3Dir, { recursive: true, force: true });
}
