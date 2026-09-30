import { mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
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
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import { removeFoldedStagingFiles } from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";
import { rebuildTimelineParquet } from "#src/report-lake/timeline-compaction.ts";
import type { ReportLakeProgress } from "#src/report-lake/compaction-types.ts";

const logger = createLogger("report-lake-rebuild");
const GC_KEEP_BUILDS = 2;
const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

export async function rebuildReportLake(
  prisma: ExtendedPrismaClient,
  lakeDir: string,
  startedAt: number,
  onProgress?: (progress: ReportLakeProgress) => void,
): Promise<CompactionSummary> {
  return await rebuildLocked(prisma, lakeDir, startedAt, onProgress);
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
  let published = false;

  try {
    const matchesTmp = path.join(buildDir, "matches.ndjson.tmp");
    const matchWriter = new NdjsonFileWriter(matchesTmp);
    const matchTeamsTmp = path.join(buildDir, "match-teams.ndjson.tmp");
    const matchTeamWriter = new NdjsonFileWriter(matchTeamsTmp);
    const matchTeamBansTmp = path.join(buildDir, "match-team-bans.ndjson.tmp");
    const matchTeamBanWriter = new NdjsonFileWriter(matchTeamBansTmp);
    const foldedMatchIds = new Set<string>();
    const prematchTmp = path.join(buildDir, "prematch.ndjson.tmp");
    const prematchWriter = new NdjsonFileWriter(prematchTmp);
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
    const skippedMatches = await populateMatchesFromS3({
      client,
      bucket,
      writer: matchWriter,
      teamWriter: matchTeamWriter,
      teamBanWriter: matchTeamBanWriter,
      foldedIds: foldedMatchIds,
      puuidRemap,
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
      puuidRemap,
      abortSignal: deadline,
      onProgress: (progress) => {
        onProgress?.({ phase: "reading-s3", table: "prematch", ...progress });
      },
    });
    const timelines = await rebuildTimelineParquet({
      client,
      bucket,
      buildDir,
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
    onProgress?.({
      phase: "writing-parquet",
      files: foldedMatchIds.size + foldedPrematchIds.size,
      rows: matchWriter.rows + prematchWriter.rows,
      skipped: skippedMatches + skippedPrematches,
    });

    try {
      await withDuckDBConnection(
        async (session) => {
          if (matchWriter.rows > 0) {
            await session.run(
              `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(MATCH_LAKE_COLUMNS)})) TO '${path.join(buildDir, "matches")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
              [matchesTmp],
            );
          }
          if (matchTeamWriter.rows > 0) {
            await session.run(
              `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(MATCH_TEAM_LAKE_COLUMNS)})) TO '${path.join(buildDir, "match_teams")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
              [matchTeamsTmp],
            );
          }
          if (matchTeamBanWriter.rows > 0) {
            await session.run(
              `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(MATCH_TEAM_BAN_LAKE_COLUMNS)})) TO '${path.join(buildDir, "match_team_bans")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
              [matchTeamBansTmp],
            );
          }
          if (prematchWriter.rows > 0) {
            await session.run(
              `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(PREMATCH_LAKE_COLUMNS)})) TO '${path.join(buildDir, "prematch")}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
              [prematchTmp],
            );
          }
        },
        { timeoutMs: remainingTimeoutMs() },
      );
    } finally {
      await unlink(matchesTmp);
      await unlink(matchTeamsTmp);
      await unlink(matchTeamBansTmp);
      await unlink(prematchTmp);
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
    await publishBuild(lakeDir, buildId);
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
    await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

    const durationMs = Date.now() - startedAt;
    logger.info(
      `Rebuild (s3) published build ${buildId} (${matchWriter.rows.toString()} match rows, ${prematchWriter.rows.toString()} prematch rows, ${skippedMatches.toString()} skipped) in ${durationMs.toString()}ms`,
    );
    return { ...summary, durationMs };
  } finally {
    if (!published) {
      await rm(buildDir, { recursive: true, force: true });
    }
  }
}
