import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma as defaultPrisma } from "#src/database/index.ts";
import {
  readBuildFingerprint,
  readBuildPuuidRemapFingerprint,
} from "#src/report-lake/build-manifest.ts";
import { createLogger } from "#src/logger.ts";
import {
  publishCompactionMetrics,
  writeCompactionManifest,
  type CompactionSummary as PublishedCompactionSummary,
} from "#src/report-lake/compaction-publish.ts";
type CompactionSummary = PublishedCompactionSummary;
import {
  loadPuuidRemap,
  puuidRemapFingerprint,
} from "#src/report-lake/puuid-remap.ts";
import {
  buildDirPath,
  ensureLakeScaffold,
  gcOldBuilds,
  newBuildId,
  publishBuild,
  readCurrentBuildDir,
  resolveLakeDir,
} from "#src/report-lake/paths.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import { removeFoldedStagingFiles } from "#src/report-lake/staging.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";
import { linkTreeContents } from "#src/report-lake/link-tree.ts";
import type { CompactionOptions } from "#src/report-lake/compaction-types.ts";
import { writeFoldParquet } from "#src/report-lake/fold-parquet.ts";
import { readStagingRows } from "#src/report-lake/read-staging-rows.ts";
import { rebuildReportLake } from "#src/report-lake/rebuild-report-lake.ts";

const logger = createLogger("report-lake-compactor");

const GC_KEEP_BUILDS = 2;

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
      return await rebuildReportLake(
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
      return await rebuildReportLake(
        prisma,
        lakeDir,
        startedAt,
        options.onProgress,
      );
    }

    // A fold cannot retranslate history: it hardlinks the published parquet and
    // only appends. If the PUUID domain moved since that build, match rows would
    // keep old identifiers while accounts — read from the re-domained database —
    // moved on, hiding historical results. Rebuild instead.
    const publishedRemap = await readBuildPuuidRemapFingerprint(currentDir);
    const currentRemap = puuidRemapFingerprint(await loadPuuidRemap(prisma));
    if (publishedRemap !== currentRemap) {
      logger.info(
        `PUUID remap changed since the published build (${publishedRemap ?? "unrecorded"} -> ${currentRemap}); folding via full rebuild`,
      );
      return await rebuildReportLake(
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
    const stagedMatchTeams = await readStagingRows(
      lakeDir,
      "match_teams",
      options.onProgress,
    );
    const stagedMatchTeamBans = await readStagingRows(
      lakeDir,
      "match_team_bans",
      options.onProgress,
    );
    const stagedRankHistory = await readStagingRows(
      lakeDir,
      "competition_rank_history",
      options.onProgress,
    );
    const stagedTimelineEvents = await readStagingRows(
      lakeDir,
      "timeline_events",
      options.onProgress,
    );
    const stagedTimelineEventParticipants = await readStagingRows(
      lakeDir,
      "timeline_event_participants",
      options.onProgress,
    );
    const stagedTimelineParticipantFrames = await readStagingRows(
      lakeDir,
      "timeline_participant_frames",
      options.onProgress,
    );
    const stagedTimelineCoverage = await readStagingRows(
      lakeDir,
      "timeline_coverage",
      options.onProgress,
    );
    await writeFoldParquet(buildDir, buildId, "matches", stagedMatches);
    await writeFoldParquet(buildDir, buildId, "match_teams", stagedMatchTeams);
    await writeFoldParquet(
      buildDir,
      buildId,
      "match_team_bans",
      stagedMatchTeamBans,
    );
    await writeFoldParquet(buildDir, buildId, "prematch", stagedPrematches);
    await writeFoldParquet(
      buildDir,
      buildId,
      "competition_rank_history",
      stagedRankHistory,
    );
    await writeFoldParquet(
      buildDir,
      buildId,
      "timeline_events",
      stagedTimelineEvents,
    );
    await writeFoldParquet(
      buildDir,
      buildId,
      "timeline_event_participants",
      stagedTimelineEventParticipants,
    );
    await writeFoldParquet(
      buildDir,
      buildId,
      "timeline_participant_frames",
      stagedTimelineParticipantFrames,
    );
    await writeFoldParquet(
      buildDir,
      buildId,
      "timeline_coverage",
      stagedTimelineCoverage,
    );
    const accountRows = await writeAccountsParquet(prisma, buildDir);
    options.onProgress?.({ phase: "publishing", rows: accountRows });

    const summary = {
      buildId,
      tier: "fold" as const,
      matchRows: stagedMatches.rows,
      matchTeamRows: stagedMatchTeams.rows,
      matchTeamBanRows: stagedMatchTeamBans.rows,
      prematchRows: stagedPrematches.rows,
      accountRows,
      competitionRankHistoryRows: stagedRankHistory.rows,
      timelineEventRows: stagedTimelineEvents.rows,
      timelineEventParticipantRows: stagedTimelineEventParticipants.rows,
      timelineParticipantFrameRows: stagedTimelineParticipantFrames.rows,
      timelineCoverageRows: stagedTimelineCoverage.rows,
      skippedMatches: stagedMatches.skipped,
      skippedPrematches: stagedPrematches.skipped,
      skippedCompetitionRankHistory: stagedRankHistory.skipped,
      skippedTimelines:
        stagedTimelineEvents.skipped +
        stagedTimelineEventParticipants.skipped +
        stagedTimelineParticipantFrames.skipped +
        stagedTimelineCoverage.skipped,
    };
    // The fold only reaches here when the published build already matches the
    // current remap, so carrying it forward keeps the manifest truthful.
    await writeCompactionManifest(buildDir, summary, currentRemap);
    await publishBuild(lakeDir, buildId);
    publishCompactionMetrics(summary);
    await removeFoldedStagingFiles(lakeDir, "matches", stagedMatches.foldedIds);
    await removeFoldedStagingFiles(
      lakeDir,
      "match_teams",
      stagedMatchTeams.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "match_team_bans",
      stagedMatchTeamBans.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "prematch",
      stagedPrematches.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "competition_rank_history",
      stagedRankHistory.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "timeline_events",
      stagedTimelineEvents.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "timeline_event_participants",
      stagedTimelineEventParticipants.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "timeline_participant_frames",
      stagedTimelineParticipantFrames.foldedIds,
    );
    await removeFoldedStagingFiles(
      lakeDir,
      "timeline_coverage",
      stagedTimelineCoverage.foldedIds,
    );
    await gcOldBuilds(lakeDir, GC_KEEP_BUILDS);

    const durationMs = Date.now() - startedAt;
    logger.info(
      `Fold published build ${buildId} (+${stagedMatches.rows.toString()} match rows, +${stagedPrematches.rows.toString()} prematch rows, +${stagedRankHistory.rows.toString()} rank-history rows) in ${durationMs.toString()}ms`,
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
    return await rebuildReportLake(
      prisma,
      lakeDir,
      Date.now(),
      options.onProgress,
    );
  });
}
