import { copyFile, link, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma as defaultPrisma } from "#src/database/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  reportLakeCompactionRowsTotal,
  reportLakeCompactionSkippedTotal,
  reportLakeLastPublishTimestamp,
} from "#src/metrics/report-lake.ts";
import { accountToLakeRow } from "#src/report-lake/flatten.ts";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  populateMatchesFromS3,
  populatePrematchFromS3,
} from "#src/report-lake/rebuild-sources.ts";
import {
  buildDirPath,
  ensureLakeScaffold,
  gcOldBuilds,
  newBuildId,
  publishBuild,
  readCurrentBuildDir,
  resolveLakeDir,
} from "#src/report-lake/paths.ts";
import {
  ACCOUNT_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  MatchLakeRowSchema,
  PREMATCH_LAKE_COLUMNS,
  PrematchLakeRowSchema,
  duckDbColumnsSpec,
} from "#src/report-lake/schema.ts";
import {
  listStagingFiles,
  removeFoldedStagingFiles,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

const logger = createLogger("report-lake-compactor");

const GC_KEEP_BUILDS = 2;
// A full-history rebuild now enumerates + fetches every raw object from S3,
// which is slower than the old local SQLite scan — give it a generous ceiling.
const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

export type CompactionSummary = {
  buildId: string;
  tier: "fold" | "rebuild";
  matchRows: number;
  prematchRows: number;
  accountRows: number;
  skippedMatches: number;
  skippedPrematches: number;
  durationMs: number;
};

export type CompactionOptions = {
  prisma?: ExtendedPrismaClient;
  lakeDir?: string;
};

let compactionInFlight = false;

async function withCompactionLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (compactionInFlight) {
    logger.info("Skipping compaction run: another run is in flight");
    return null;
  }
  compactionInFlight = true;
  try {
    return await fn();
  } finally {
    compactionInFlight = false;
  }
}

/** Hardlink (fallback: copy) every file under srcDir into dstDir, recursively. */
async function linkTreeContents(srcDir: string, dstDir: string): Promise<void> {
  const entries = await readdir(srcDir, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const src = path.join(entry.parentPath, entry.name);
    const relative = src.slice(srcDir.length + 1);
    const dst = path.join(dstDir, relative);
    await mkdir(path.dirname(dst), { recursive: true });
    try {
      await link(src, dst);
    } catch {
      await copyFile(src, dst);
    }
  }
}

async function writeAccountsParquet(
  prisma: ExtendedPrismaClient,
  buildDir: string,
): Promise<number> {
  const accounts = await prisma.account.findMany({
    include: { player: true },
  });
  const tmpPath = path.join(buildDir, "accounts.ndjson.tmp");
  const writer = new NdjsonFileWriter(tmpPath);
  for (const account of accounts) {
    writer.write(accountToLakeRow(account));
  }
  await writer.close();

  const accountsDir = path.join(buildDir, "accounts");
  await mkdir(accountsDir, { recursive: true });
  const parquetPath = path.join(accountsDir, "accounts.parquet");
  // The fold tier hardlinks the previous build's accounts.parquet into place
  // first; remove the link so COPY writes a fresh inode without touching the
  // previous build's file.
  try {
    await unlink(parquetPath);
  } catch {
    // Fresh build dir: nothing to unlink.
  }
  try {
    if (accounts.length > 0) {
      await withDuckDBConnection(
        async (session) => {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(ACCOUNT_LAKE_COLUMNS)})) TO '${parquetPath}' (FORMAT PARQUET)`,
            [tmpPath],
          );
        },
        { timeoutMs: COMPACTION_TIMEOUT_MS },
      );
    }
  } finally {
    await unlink(tmpPath);
  }
  return accounts.length;
}

async function writeManifest(
  buildDir: string,
  summary: Omit<CompactionSummary, "durationMs">,
): Promise<void> {
  await Bun.write(
    path.join(buildDir, "manifest.json"),
    JSON.stringify({ ...summary, builtAt: new Date().toISOString() }, null, 2),
  );
}

function publishMetrics(summary: Omit<CompactionSummary, "durationMs">): void {
  reportLakeCompactionRowsTotal.inc(
    { table: "matches", tier: summary.tier },
    summary.matchRows,
  );
  reportLakeCompactionRowsTotal.inc(
    { table: "prematch", tier: summary.tier },
    summary.prematchRows,
  );
  reportLakeCompactionRowsTotal.inc(
    { table: "accounts", tier: summary.tier },
    summary.accountRows,
  );
  reportLakeLastPublishTimestamp.set({ tier: summary.tier }, Date.now() / 1000);
}

type StagingParseResult = {
  rowsByMonth: Map<string, object[]>;
  foldedIds: Set<string>;
  rows: number;
  skipped: number;
};

async function readStagingRows(
  lakeDir: string,
  table: "matches" | "prematch",
): Promise<StagingParseResult> {
  const schema =
    table === "matches" ? MatchLakeRowSchema : PrematchLakeRowSchema;
  const rowsByMonth = new Map<string, object[]>();
  const foldedIds = new Set<string>();
  let rows = 0;
  let skipped = 0;

  for (const file of await listStagingFiles(lakeDir, table)) {
    const stem = file
      .split("/")
      .at(-1)
      ?.replace(/\.jsonl$/, "");
    if (stem === undefined) {
      continue;
    }
    const text = await Bun.file(file).text();
    let fileOk = true;
    const fileRows: { month: string; row: object }[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      let parsedLine: unknown;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        fileOk = false;
        break;
      }
      const parsed = schema.safeParse(parsedLine);
      if (!parsed.success) {
        fileOk = false;
        break;
      }
      fileRows.push({ month: parsed.data.month, row: parsed.data });
    }
    if (!fileOk) {
      // Leave the file for the nightly rebuild path, which re-derives the
      // same data from S3; count it so drift is visible.
      reportLakeCompactionSkippedTotal.inc({ table });
      skipped += 1;
      logger.warn(`Staging file failed validation, leaving for rebuild`, {
        file,
      });
      continue;
    }
    for (const { month, row } of fileRows) {
      const bucket = rowsByMonth.get(month) ?? [];
      bucket.push(row);
      rowsByMonth.set(month, bucket);
      rows += 1;
    }
    foldedIds.add(stem);
  }
  return { rowsByMonth, foldedIds, rows, skipped };
}

async function writeFoldParquet(
  buildDir: string,
  buildId: string,
  table: "matches" | "prematch",
  staged: StagingParseResult,
): Promise<void> {
  const columns =
    table === "matches" ? MATCH_LAKE_COLUMNS : PREMATCH_LAKE_COLUMNS;
  for (const [month, rows] of staged.rowsByMonth) {
    const monthDir = path.join(buildDir, table, `month=${month}`);
    await mkdir(monthDir, { recursive: true });
    const tmpPath = path.join(buildDir, `${table}-${month}-fold.ndjson.tmp`);
    const writer = new NdjsonFileWriter(tmpPath);
    for (const row of rows) {
      writer.write(row);
    }
    await writer.close();
    const parquetPath = path.join(monthDir, `fold-${buildId}.parquet`);
    try {
      await withDuckDBConnection(
        async (session) => {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(columns)})) TO '${parquetPath}' (FORMAT PARQUET)`,
            [tmpPath],
          );
        },
        { timeoutMs: COMPACTION_TIMEOUT_MS },
      );
    } finally {
      await unlink(tmpPath);
    }
  }
}

/**
 * Tier 1 — fold: hardlink the current build, add staged rows as fold
 * parquet files, refresh the accounts snapshot, publish. Cost scales with
 * the staging backlog (typically a handful of matches), never with total
 * lake size. Falls back to a full rebuild when the lake has never been
 * compacted.
 */
export async function runReportLakeFold(
  options: CompactionOptions = {},
): Promise<CompactionSummary | null> {
  return await withCompactionLock(async () => {
    const startedAt = Date.now();
    const prisma = options.prisma ?? defaultPrisma;
    const lakeDir = options.lakeDir ?? resolveLakeDir();
    await ensureLakeScaffold(lakeDir);

    const currentDir = await readCurrentBuildDir(lakeDir);
    if (currentDir === undefined) {
      logger.info("No published build yet; folding via full rebuild");
      return await rebuildLocked(prisma, lakeDir, startedAt);
    }

    const buildId = newBuildId();
    const buildDir = buildDirPath(lakeDir, buildId);
    await mkdir(buildDir, { recursive: true });
    await linkTreeContents(currentDir, buildDir);
    try {
      await unlink(path.join(buildDir, "manifest.json"));
    } catch {
      // A build without a manifest is unusual but not worth failing over.
    }

    const stagedMatches = await readStagingRows(lakeDir, "matches");
    const stagedPrematches = await readStagingRows(lakeDir, "prematch");
    await writeFoldParquet(buildDir, buildId, "matches", stagedMatches);
    await writeFoldParquet(buildDir, buildId, "prematch", stagedPrematches);
    const accountRows = await writeAccountsParquet(prisma, buildDir);

    const summary = {
      buildId,
      tier: "fold" as const,
      matchRows: stagedMatches.rows,
      prematchRows: stagedPrematches.rows,
      accountRows,
      skippedMatches: stagedMatches.skipped,
      skippedPrematches: stagedPrematches.skipped,
    };
    await writeManifest(buildDir, summary);
    await publishBuild(lakeDir, buildId);
    publishMetrics(summary);
    await removeFoldedStagingFiles(lakeDir, "matches", stagedMatches.foldedIds);
    await removeFoldedStagingFiles(
      lakeDir,
      "prematch",
      stagedPrematches.foldedIds,
    );
    await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

    const durationMs = Date.now() - startedAt;
    logger.info(
      `Fold published build ${buildId} (+${stagedMatches.rows.toString()} match rows, +${stagedPrematches.rows.toString()} prematch rows) in ${durationMs.toString()}ms`,
    );
    return { ...summary, durationMs };
  });
}

/**
 * Tier 2 — full rebuild by enumerating the canonical raw JSON from S3. The
 * recovery and consolidation path: picks up schema changes, squashes fold-file
 * fragmentation, and re-derives the entire lake from scratch.
 */
export async function runReportLakeRebuild(
  options: CompactionOptions = {},
): Promise<CompactionSummary | null> {
  return await withCompactionLock(async () => {
    const prisma = options.prisma ?? defaultPrisma;
    const lakeDir = options.lakeDir ?? resolveLakeDir();
    await ensureLakeScaffold(lakeDir);
    return await rebuildLocked(prisma, lakeDir, Date.now());
  });
}

async function rebuildLocked(
  prisma: ExtendedPrismaClient,
  lakeDir: string,
  startedAt: number,
): Promise<CompactionSummary> {
  const buildId = newBuildId();
  const buildDir = buildDirPath(lakeDir, buildId);
  await mkdir(buildDir, { recursive: true });

  const matchesTmp = path.join(buildDir, "matches.ndjson.tmp");
  const matchWriter = new NdjsonFileWriter(matchesTmp);
  const foldedMatchIds = new Set<string>();
  const prematchTmp = path.join(buildDir, "prematch.ndjson.tmp");
  const prematchWriter = new NdjsonFileWriter(prematchTmp);
  const foldedPrematchIds = new Set<string>();

  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw new Error(
      "S3_BUCKET_NAME not configured — cannot rebuild the report lake from S3.",
    );
  }
  const client = createS3Client();
  const skippedMatches = await populateMatchesFromS3(
    client,
    bucket,
    matchWriter,
    foldedMatchIds,
  );
  const skippedPrematches = await populatePrematchFromS3(
    client,
    bucket,
    prematchWriter,
    foldedPrematchIds,
  );
  await matchWriter.close();
  await prematchWriter.close();

  // --- NDJSON -> partitioned parquet ---
  try {
    await withDuckDBConnection(
      async (session) => {
        if (matchWriter.rows > 0) {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(MATCH_LAKE_COLUMNS)})) TO '${path.join(buildDir, "matches")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
            [matchesTmp],
          );
        }
        if (prematchWriter.rows > 0) {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(PREMATCH_LAKE_COLUMNS)})) TO '${path.join(buildDir, "prematch")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
            [prematchTmp],
          );
        }
      },
      { timeoutMs: COMPACTION_TIMEOUT_MS },
    );
  } finally {
    await unlink(matchesTmp);
    await unlink(prematchTmp);
  }

  const accountRows = await writeAccountsParquet(prisma, buildDir);

  const summary = {
    buildId,
    tier: "rebuild" as const,
    matchRows: matchWriter.rows,
    prematchRows: prematchWriter.rows,
    accountRows,
    skippedMatches,
    skippedPrematches,
  };
  await writeManifest(buildDir, summary);
  await publishBuild(lakeDir, buildId);
  publishMetrics(summary);
  await removeFoldedStagingFiles(lakeDir, "matches", foldedMatchIds);
  await removeFoldedStagingFiles(lakeDir, "prematch", foldedPrematchIds);
  await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

  const durationMs = Date.now() - startedAt;
  logger.info(
    `Rebuild (s3) published build ${buildId} (${matchWriter.rows.toString()} match rows, ${prematchWriter.rows.toString()} prematch rows, ${skippedMatches.toString()} skipped) in ${durationMs.toString()}ms`,
  );
  return { ...summary, durationMs };
}
