import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma as defaultPrisma } from "#src/database/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { readBuildFingerprint } from "#src/report-lake/build-manifest.ts";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/report-lake.ts";
import {
  publishCompactionMetrics,
  writeCompactionManifest,
  type CompactionSummary as PublishedCompactionSummary,
} from "#src/report-lake/compaction-publish.ts";
type CompactionSummary = PublishedCompactionSummary;
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  populateMatchesFromS3,
  populatePrematchFromS3,
  populatePredictionObservationsFromS3,
} from "#src/report-lake/rebuild-sources.ts";
import { writeCompetitionRankHistoryParquet } from "#src/report-lake/rank-history-compaction.ts";
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
  CompetitionRankHistoryLakeRowSchema,
  MATCH_LAKE_COLUMNS,
  MatchLakeRowSchema,
  PREMATCH_LAKE_COLUMNS,
  PrematchLakeRowSchema,
  PREDICTION_OBSERVATION_LAKE_COLUMNS,
  PredictionObservationLakeRowSchema,
} from "@scout-for-lol/data";
import {
  duckDbColumnsSpec,
  lakeSchemaFingerprint,
} from "#src/report-lake/schema.ts";
import {
  listStagingFiles,
  removeFoldedStagingFiles,
  type ReportLakeStagingTable,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";
import { linkTreeContents } from "#src/report-lake/link-tree.ts";
import type {
  CompactionOptions,
  ReportLakeProgress,
} from "#src/report-lake/compaction-types.ts";
import {
  type StagingParseResult,
  writeFoldParquet,
} from "#src/report-lake/fold-parquet.ts";

const logger = createLogger("report-lake-compactor");

const GC_KEEP_BUILDS = 2;
// A full-history rebuild now enumerates + fetches every raw object from S3,
// which is slower than the old local SQLite scan — give it a generous ceiling.
const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

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

async function readStagingRows(
  lakeDir: string,
  table: ReportLakeStagingTable,
  onProgress?: (progress: ReportLakeProgress) => void,
): Promise<StagingParseResult> {
  const schema =
    table === "matches"
      ? MatchLakeRowSchema
      : table === "prematch"
        ? PrematchLakeRowSchema
        : table === "prediction_observations"
          ? PredictionObservationLakeRowSchema
          : CompetitionRankHistoryLakeRowSchema;
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
    onProgress?.({
      phase: "reading-staging",
      table,
      files: foldedIds.size + skipped,
      rows,
      skipped,
    });
  }
  return { rowsByMonth, foldedIds, rows, skipped };
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
    options.onProgress?.({ phase: "scaffolding" });
    await ensureLakeScaffold(lakeDir);

    const currentDir = await readCurrentBuildDir(lakeDir);
    if (currentDir === undefined) {
      logger.info("No published build yet; folding via full rebuild");
      return await rebuildLocked(
        prisma,
        lakeDir,
        startedAt,
        options.onProgress,
      );
    }

    // A fold hardlinks the published build's parquet and appends fold files
    // written at the CURRENT column set. If those disagree, the resulting build
    // does not read at all (see lakeSchemaFingerprint), so rebuild instead.
    const publishedFingerprint = await readBuildFingerprint(currentDir);
    if (publishedFingerprint !== lakeSchemaFingerprint()) {
      logger.info(
        `Lake column set changed since the published build (${publishedFingerprint ?? "unrecorded"} -> ${lakeSchemaFingerprint()}); folding via full rebuild`,
      );
      return await rebuildLocked(
        prisma,
        lakeDir,
        startedAt,
        options.onProgress,
      );
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

    const stagedMatches = await readStagingRows(
      lakeDir,
      "matches",
      options.onProgress,
    );
    const stagedPrematches = await readStagingRows(
      lakeDir,
      "prematch",
      options.onProgress,
    );
    const stagedPredictionObservations = await readStagingRows(
      lakeDir,
      "prediction_observations",
      options.onProgress,
    );
    const stagedRankHistory = await readStagingRows(
      lakeDir,
      "competition_rank_history",
      options.onProgress,
    );
    await writeFoldParquet(buildDir, buildId, "matches", stagedMatches);
    await writeFoldParquet(buildDir, buildId, "prematch", stagedPrematches);
    await writeFoldParquet(
      buildDir,
      buildId,
      "prediction_observations",
      stagedPredictionObservations,
    );
    await writeFoldParquet(
      buildDir,
      buildId,
      "competition_rank_history",
      stagedRankHistory,
    );
    const accountRows = await writeAccountsParquet(prisma, buildDir);
    options.onProgress?.({ phase: "publishing", rows: accountRows });

    const summary = {
      buildId,
      tier: "fold" as const,
      matchRows: stagedMatches.rows,
      prematchRows: stagedPrematches.rows,
      predictionObservationRows: stagedPredictionObservations.rows,
      accountRows,
      competitionRankHistoryRows: stagedRankHistory.rows,
      skippedMatches: stagedMatches.skipped,
      skippedPrematches: stagedPrematches.skipped,
      skippedPredictionObservations: stagedPredictionObservations.skipped,
      skippedCompetitionRankHistory: stagedRankHistory.skipped,
    };
    await writeCompactionManifest(buildDir, summary);
    await publishBuild(lakeDir, buildId);
    publishCompactionMetrics(summary);
    await removeFoldedStagingFiles(lakeDir, "matches", stagedMatches.foldedIds);
    await removeFoldedStagingFiles(
      lakeDir,
      "prematch",
      stagedPrematches.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "prediction_observations",
      stagedPredictionObservations.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "competition_rank_history",
      stagedRankHistory.foldedIds,
    );
    await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

    const durationMs = Date.now() - startedAt;
    logger.info(
      `Fold published build ${buildId} (+${stagedMatches.rows.toString()} match rows, +${stagedPrematches.rows.toString()} prematch rows, +${stagedPredictionObservations.rows.toString()} prediction rows, +${stagedRankHistory.rows.toString()} rank-history rows) in ${durationMs.toString()}ms`,
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
    options.onProgress?.({ phase: "scaffolding" });
    await ensureLakeScaffold(lakeDir);
    return await rebuildLocked(prisma, lakeDir, Date.now(), options.onProgress);
  });
}

async function rebuildLocked(
  prisma: ExtendedPrismaClient,
  lakeDir: string,
  startedAt: number,
  onProgress?: (progress: ReportLakeProgress) => void,
): Promise<CompactionSummary> {
  const deadlineAt = Date.now() + COMPACTION_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(COMPACTION_TIMEOUT_MS);
  const remainingTimeoutMs = (): number => Math.max(1, deadlineAt - Date.now());
  const buildId = newBuildId();
  const buildDir = buildDirPath(lakeDir, buildId);
  await mkdir(buildDir, { recursive: true });

  const matchesTmp = path.join(buildDir, "matches.ndjson.tmp");
  const matchWriter = new NdjsonFileWriter(matchesTmp);
  const foldedMatchIds = new Set<string>();
  const prematchTmp = path.join(buildDir, "prematch.ndjson.tmp");
  const prematchWriter = new NdjsonFileWriter(prematchTmp);
  const foldedPrematchIds = new Set<string>();
  const predictionsTmp = path.join(
    buildDir,
    "prediction-observations.ndjson.tmp",
  );
  const predictionWriter = new NdjsonFileWriter(predictionsTmp);
  const foldedPredictionIds = new Set<string>();
  const foldedRankHistoryIds = new Set<string>();

  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    throw new Error(
      "S3_BUCKET_NAME not configured — cannot rebuild the report lake from S3.",
    );
  }
  const client = createS3Client();
  const skippedMatches = await populateMatchesFromS3({
    client,
    bucket,
    writer: matchWriter,
    foldedIds: foldedMatchIds,
    abortSignal: deadline,
    onProgress: (progress) => {
      onProgress?.({ phase: "reading-s3", table: "matches", ...progress });
    },
  });
  const skippedPrematches = await populatePrematchFromS3({
    client,
    bucket,
    writer: prematchWriter,
    foldedIds: foldedPrematchIds,
    abortSignal: deadline,
    onProgress: (progress) => {
      onProgress?.({ phase: "reading-s3", table: "prematch", ...progress });
    },
  });
  const skippedPredictionObservations =
    await populatePredictionObservationsFromS3({
      client,
      bucket,
      writer: predictionWriter,
      foldedIds: foldedPredictionIds,
      abortSignal: deadline,
      onProgress: (progress) => {
        onProgress?.({
          phase: "reading-s3",
          table: "prediction_observations",
          ...progress,
        });
      },
    });
  deadline.throwIfAborted();
  await matchWriter.close();
  await prematchWriter.close();
  await predictionWriter.close();
  onProgress?.({
    phase: "writing-parquet",
    files:
      foldedMatchIds.size + foldedPrematchIds.size + foldedPredictionIds.size,
    rows: matchWriter.rows + prematchWriter.rows + predictionWriter.rows,
    skipped: skippedMatches + skippedPrematches + skippedPredictionObservations,
  });

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
        if (predictionWriter.rows > 0) {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(PREDICTION_OBSERVATION_LAKE_COLUMNS)})) TO '${path.join(buildDir, "prediction_observations")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
            [predictionsTmp],
          );
        }
      },
      { timeoutMs: remainingTimeoutMs() },
    );
  } finally {
    await unlink(matchesTmp);
    await unlink(prematchTmp);
    await unlink(predictionsTmp);
  }

  deadline.throwIfAborted();
  const accountRows = await writeAccountsParquet(prisma, buildDir);
  onProgress?.({ phase: "writing-accounts", rows: accountRows });
  deadline.throwIfAborted();
  const rankHistory = await writeCompetitionRankHistoryParquet({
    buildDir,
    foldedIds: foldedRankHistoryIds,
    abortSignal: deadline,
    timeoutMs: remainingTimeoutMs(),
  });
  onProgress?.({
    phase: "publishing",
    table: "competition_rank_history",
    files: foldedRankHistoryIds.size,
    rows: rankHistory.rows,
    skipped: rankHistory.skipped,
  });
  deadline.throwIfAborted();

  const summary = {
    buildId,
    tier: "rebuild" as const,
    matchRows: matchWriter.rows,
    prematchRows: prematchWriter.rows,
    predictionObservationRows: predictionWriter.rows,
    accountRows,
    competitionRankHistoryRows: rankHistory.rows,
    skippedMatches,
    skippedPrematches,
    skippedPredictionObservations,
    skippedCompetitionRankHistory: rankHistory.skipped,
  };
  await writeCompactionManifest(buildDir, summary);
  await publishBuild(lakeDir, buildId);
  publishCompactionMetrics(summary);
  await removeFoldedStagingFiles(lakeDir, "matches", foldedMatchIds);
  await removeFoldedStagingFiles(lakeDir, "prematch", foldedPrematchIds);
  await removeFoldedStagingFiles(
    lakeDir,
    "prediction_observations",
    foldedPredictionIds,
  );
  await removeFoldedStagingFiles(
    lakeDir,
    "competition_rank_history",
    foldedRankHistoryIds,
  );
  await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

  const durationMs = Date.now() - startedAt;
  logger.info(
    `Rebuild (s3) published build ${buildId} (${matchWriter.rows.toString()} match rows, ${prematchWriter.rows.toString()} prematch rows, ${predictionWriter.rows.toString()} prediction rows, ${skippedMatches.toString()} skipped) in ${durationMs.toString()}ms`,
  );
  return { ...summary, durationMs };
}
