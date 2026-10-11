import { mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { RAW_DOCUMENT_LAKE_COLUMNS } from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import {
  publishCompactionMetrics,
  writeCompactionManifest,
  type CompactionSummary as PublishedCompactionSummary,
} from "#src/report-lake/compaction-publish.ts";
type CompactionSummary = PublishedCompactionSummary;
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { copyNdjsonToParquet } from "#src/report-lake/parquet/copy-ndjson.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  loadPuuidRemap,
  puuidRemapFingerprint,
} from "#src/report-lake/puuid-remap.ts";
import {
  populateMatchesFromS3,
  populatePrematchFromS3,
} from "#src/report-lake/rebuild-sources.ts";
import { writeCompetitionRankHistoryParquet } from "#src/report-lake/rank-history-compaction.ts";
import {
  buildDirPath,
  gcOldBuilds,
  newBuildId,
  publishBuild,
} from "#src/report-lake/paths.ts";
import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
} from "@scout-for-lol/data";
import { removeFoldedStagingFiles } from "#src/report-lake/staging.ts";
import {
  reclaimAbandonedPendingGenerations,
  removeRebuiltGenerations,
  snapshotStagingGenerations,
} from "#src/report-lake/staging/generations.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";
import { rebuildTimelineParquet } from "#src/report-lake/timeline-compaction.ts";
import type { CompactionOptions } from "#src/report-lake/compaction-types.ts";

const logger = createLogger("report-lake-rebuild");
const GC_KEEP_BUILDS = 2;
const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

export async function rebuildReportLake(
  prisma: ExtendedPrismaClient,
  lakeDir: string,
  startedAt: number,
  options: Pick<CompactionOptions, "onProgress" | "abortSignal"> = {},
): Promise<CompactionSummary> {
  const { onProgress, abortSignal } = options;
  const deadlineAt = Date.now() + COMPACTION_TIMEOUT_MS;
  const deadline = AbortSignal.any([
    AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
    ...(abortSignal === undefined ? [] : [abortSignal]),
  ]);
  deadline.throwIfAborted();
  const remainingTimeoutMs = (): number => Math.max(1, deadlineAt - Date.now());
  const buildId = newBuildId();
  const buildDir = buildDirPath(lakeDir, buildId);
  await mkdir(buildDir, { recursive: true });
  await reclaimAbandonedPendingGenerations(lakeDir);
  const stagingSnapshot = await snapshotStagingGenerations(lakeDir);
  const rebuiltSources = new Set<string>();
  const writers: NdjsonFileWriter[] = [];
  const createWriter = (file: string) => {
    const writer = new NdjsonFileWriter(file, undefined, deadline);
    writers.push(writer);
    return writer;
  };
  let published = false;

  try {
    const matchesTmp = path.join(buildDir, "matches.ndjson.tmp");
    const matchWriter = createWriter(matchesTmp);
    const rawTmp = path.join(buildDir, "raw-documents.ndjson.tmp");
    const rawWriter = createWriter(rawTmp);
    const matchTeamsTmp = path.join(buildDir, "match-teams.ndjson.tmp");
    const matchTeamWriter = createWriter(matchTeamsTmp);
    const matchTeamBansTmp = path.join(buildDir, "match-team-bans.ndjson.tmp");
    const matchTeamBanWriter = createWriter(matchTeamBansTmp);
    const foldedMatchIds = new Set<string>();
    const prematchTmp = path.join(buildDir, "prematch.ndjson.tmp");
    const prematchWriter = createWriter(prematchTmp);
    const foldedPrematchIds = new Set<string>();
    const foldedRankHistoryIds = new Set<string>();

    const bucket = configuration.s3BucketName;
    if (bucket === undefined) {
      throw new Error(
        "S3_BUCKET_NAME not configured — cannot rebuild the report lake from S3.",
      );
    }
    const client = createS3Client();
    const puuidRemap = await loadPuuidRemap(prisma);
    deadline.throwIfAborted();
    const skippedMatches = await populateMatchesFromS3({
      client,
      bucket,
      writer: matchWriter,
      rawWriter,
      teamWriter: matchTeamWriter,
      teamBanWriter: matchTeamBanWriter,
      foldedIds: foldedMatchIds,
      foldedSources: rebuiltSources,
      puuidRemap,
      abortSignal: deadline,
      onProgress: (progress) => {
        onProgress?.({ phase: "reading-s3", table: "matches", ...progress });
      },
    });
    deadline.throwIfAborted();
    const skippedPrematches = await populatePrematchFromS3({
      client,
      bucket,
      writer: prematchWriter,
      rawWriter,
      foldedIds: foldedPrematchIds,
      foldedSources: rebuiltSources,
      puuidRemap,
      abortSignal: deadline,
      onProgress: (progress) => {
        onProgress?.({ phase: "reading-s3", table: "prematch", ...progress });
      },
    });
    deadline.throwIfAborted();
    const timelines = await rebuildTimelineParquet({
      client,
      bucket,
      buildDir,
      rawWriter,
      foldedSources: rebuiltSources,
      puuidRemap,
      abortSignal: deadline,
      timeoutMs: remainingTimeoutMs(),
      onProgress: (progress) => {
        onProgress?.({
          phase: "reading-s3",
          table: "timeline_coverage",
          ...progress,
        });
      },
    });
    deadline.throwIfAborted();
    await matchWriter.close();
    await matchTeamWriter.close();
    await matchTeamBanWriter.close();
    await prematchWriter.close();
    await rawWriter.close();
    onProgress?.({
      phase: "writing-parquet",
      files: foldedMatchIds.size + foldedPrematchIds.size,
      rows: matchWriter.rows + prematchWriter.rows,
      skipped: skippedMatches + skippedPrematches,
    });

    try {
      await withDuckDBConnection(
        async (session) => {
          if (rawWriter.rows > 0) {
            await copyNdjsonToParquet(session, {
              sourcePath: rawTmp,
              outputDirectory: path.join(buildDir, "raw_documents"),
              columns: RAW_DOCUMENT_LAKE_COLUMNS,
              partitionByMonth: true,
            });
          }
          if (matchWriter.rows > 0) {
            await copyNdjsonToParquet(session, {
              sourcePath: matchesTmp,
              outputDirectory: path.join(buildDir, "matches"),
              columns: MATCH_LAKE_COLUMNS,
              partitionByMonth: true,
            });
          }
          if (matchTeamWriter.rows > 0) {
            await copyNdjsonToParquet(session, {
              sourcePath: matchTeamsTmp,
              outputDirectory: path.join(buildDir, "match_teams"),
              columns: MATCH_TEAM_LAKE_COLUMNS,
              partitionByMonth: true,
            });
          }
          if (matchTeamBanWriter.rows > 0) {
            await copyNdjsonToParquet(session, {
              sourcePath: matchTeamBansTmp,
              outputDirectory: path.join(buildDir, "match_team_bans"),
              columns: MATCH_TEAM_BAN_LAKE_COLUMNS,
              partitionByMonth: true,
            });
          }
          if (prematchWriter.rows > 0) {
            await copyNdjsonToParquet(session, {
              sourcePath: prematchTmp,
              outputDirectory: path.join(buildDir, "prematch"),
              columns: PREMATCH_LAKE_COLUMNS,
              partitionByMonth: true,
            });
          }
        },
        { timeoutMs: remainingTimeoutMs(), abortSignal: deadline },
      );
    } finally {
      await unlink(matchesTmp);
      await unlink(matchTeamsTmp);
      await unlink(matchTeamBansTmp);
      await unlink(prematchTmp);
      await unlink(rawTmp);
    }

    deadline.throwIfAborted();
    const accountRows = await writeAccountsParquet(prisma, buildDir, deadline);
    onProgress?.({ phase: "writing-accounts", rows: accountRows });
    deadline.throwIfAborted();
    const rankHistory = await writeCompetitionRankHistoryParquet({
      buildDir,
      foldedIds: foldedRankHistoryIds,
      foldedSources: rebuiltSources,
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
      rawDocumentRows: rawWriter.rows,
      buildId,
      tier: "rebuild" as const,
      matchRows: matchWriter.rows,
      matchTeamRows: matchTeamWriter.rows,
      matchTeamBanRows: matchTeamBanWriter.rows,
      prematchRows: prematchWriter.rows,
      accountRows,
      competitionRankHistoryRows: rankHistory.rows,
      timelineEventRows: timelines.eventRows,
      timelineEventParticipantRows: timelines.eventParticipantRows,
      timelineParticipantFrameRows: timelines.participantFrameRows,
      timelineCoverageRows: timelines.coverageRows,
      skippedMatches,
      skippedPrematches,
      skippedCompetitionRankHistory: rankHistory.skipped,
      skippedTimelines: timelines.skipped,
    };
    await writeCompactionManifest(
      buildDir,
      summary,
      puuidRemapFingerprint(puuidRemap),
    );
    await publishBuild(lakeDir, buildId, deadline);
    published = true;
    publishCompactionMetrics(summary);
    await removeFoldedStagingFiles(lakeDir, "matches", foldedMatchIds);
    await removeFoldedStagingFiles(lakeDir, "match_teams", foldedMatchIds);
    await removeFoldedStagingFiles(lakeDir, "match_team_bans", foldedMatchIds);
    await removeFoldedStagingFiles(lakeDir, "prematch", foldedPrematchIds);
    await removeFoldedStagingFiles(
      lakeDir,
      "competition_rank_history",
      foldedRankHistoryIds,
    );
    for (const table of [
      "timeline_events",
      "timeline_event_participants",
      "timeline_participant_frames",
      "timeline_coverage",
    ] as const) {
      await removeFoldedStagingFiles(lakeDir, table, timelines.foldedIds);
    }
    await removeRebuiltGenerations(stagingSnapshot, rebuiltSources);
    await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

    const durationMs = Date.now() - startedAt;
    logger.info(
      `Rebuild (s3) published build ${buildId} (${matchWriter.rows.toString()} match rows, ${prematchWriter.rows.toString()} prematch rows, ${skippedMatches.toString()} skipped) in ${durationMs.toString()}ms`,
    );
    return { ...summary, durationMs };
  } finally {
    if (!published) {
      await Promise.all(writers.map(async (writer) => writer.abort()));
      await rm(buildDir, { recursive: true, force: true });
    }
  }
}
