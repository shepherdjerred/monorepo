import path from "node:path";
import configuration from "#src/configuration.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { listStagingFiles } from "#src/report-lake/staging.ts";
import { snapshotStagingGenerations } from "#src/report-lake/staging/generations.ts";
import { assertReportLakeAccess } from "#src/reports/duckdb/lake/access.ts";
import {
  NO_CRAWL_LAKE_FILES,
  resolveCrawlLakeFiles,
  type CrawlLakeFiles,
} from "#src/reports/duckdb/lake/crawl-files.ts";
import { loadCrawlTombstones } from "#src/reports/duckdb/lake/crawl-tombstones.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake/files.ts";

/**
 * Which files one report-lake query reads: the published build's Parquet,
 * the staging generations beside it, the build's crawl tables, and the
 * erasure tombstones for them. Captured together per attempt so
 * `retryLakeQuery` can replay a read whose snapshot disappeared under it.
 */

async function globParquet(root: string, table: string): Promise<string[]> {
  const glob = new Bun.Glob(`${table}/**/*.parquet`);
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: root, absolute: true })) {
    files.push(file);
  }
  return files.toSorted();
}

export async function resolveLakeFiles(
  lakeDir: string,
  capabilities: Pick<
    ScoutRuntimeCapabilities,
    "reportLakeAccess"
  > = configuration.runtimeCapabilities,
): Promise<LakeFiles> {
  assertReportLakeAccess(capabilities);
  const buildDir = await readCurrentBuildDir(lakeDir);
  const staging = await snapshotStagingGenerations(lakeDir);
  const [
    matchesStaging,
    matchTeamsStaging,
    matchTeamBansStaging,
    prematchStaging,
    competitionRankHistoryStaging,
    timelineEventsStaging,
    timelineEventParticipantsStaging,
    timelineParticipantFramesStaging,
    timelineCoverageStaging,
  ] = await Promise.all([
    listStagingFiles(lakeDir, "matches", staging),
    listStagingFiles(lakeDir, "match_teams", staging),
    listStagingFiles(lakeDir, "match_team_bans", staging),
    listStagingFiles(lakeDir, "prematch", staging),
    listStagingFiles(lakeDir, "competition_rank_history", staging),
    listStagingFiles(lakeDir, "timeline_events", staging),
    listStagingFiles(lakeDir, "timeline_event_participants", staging),
    listStagingFiles(lakeDir, "timeline_participant_frames", staging),
    listStagingFiles(lakeDir, "timeline_coverage", staging),
  ]);
  if (buildDir === undefined) {
    return {
      matchesParquet: [],
      matchesStaging,
      matchTeamsParquet: [],
      matchTeamsStaging,
      matchTeamBansParquet: [],
      matchTeamBansStaging,
      prematchParquet: [],
      prematchStaging,
      accountsParquet: undefined,
      competitionRankHistoryParquet: [],
      competitionRankHistoryStaging,
      timelineEventsParquet: [],
      timelineEventsStaging,
      timelineEventParticipantsParquet: [],
      timelineEventParticipantsStaging,
      timelineParticipantFramesParquet: [],
      timelineParticipantFramesStaging,
      timelineCoverageParquet: [],
      timelineCoverageStaging,
      crawl: NO_CRAWL_LAKE_FILES,
      crawlTombstones: [],
    };
  }
  const [
    matchesParquet,
    matchTeamsParquet,
    matchTeamBansParquet,
    prematchParquet,
    competitionRankHistoryParquet,
    timelineEventsParquet,
    timelineEventParticipantsParquet,
    timelineParticipantFramesParquet,
    timelineCoverageParquet,
  ] = await Promise.all([
    globParquet(buildDir, "matches"),
    globParquet(buildDir, "match_teams"),
    globParquet(buildDir, "match_team_bans"),
    globParquet(buildDir, "prematch"),
    globParquet(buildDir, "competition_rank_history"),
    globParquet(buildDir, "timeline_events"),
    globParquet(buildDir, "timeline_event_participants"),
    globParquet(buildDir, "timeline_participant_frames"),
    globParquet(buildDir, "timeline_coverage"),
  ]);
  const accountsPath = path.join(buildDir, "accounts", "accounts.parquet");
  const accountsParquet = (await Bun.file(accountsPath).exists())
    ? accountsPath
    : undefined;
  const crawl = await resolveCrawlLakeFiles(buildDir);
  const crawlTombstones = hasCrawlFiles(crawl)
    ? await loadCrawlTombstones()
    : [];
  // An erasure is marked complete only after the build without it publishes,
  // so tombstones read while this build is still CURRENT cover every match
  // it holds. If CURRENT moved, the snapshot retry resolves again.
  if (
    crawlTombstones.length > 0 &&
    (await readCurrentBuildDir(lakeDir)) !== buildDir
  ) {
    throw new Error("CURRENT changed while reading crawl tombstones");
  }
  return {
    matchesParquet,
    matchesStaging,
    matchTeamsParquet,
    matchTeamsStaging,
    matchTeamBansParquet,
    matchTeamBansStaging,
    prematchParquet,
    prematchStaging,
    accountsParquet,
    competitionRankHistoryParquet,
    competitionRankHistoryStaging,
    timelineEventsParquet,
    timelineEventsStaging,
    timelineEventParticipantsParquet,
    timelineEventParticipantsStaging,
    timelineParticipantFramesParquet,
    timelineParticipantFramesStaging,
    timelineCoverageParquet,
    timelineCoverageStaging,
    crawl,
    crawlTombstones,
  };
}

function hasCrawlFiles(crawl: CrawlLakeFiles): boolean {
  return Object.values(crawl).some((files) => files.length > 0);
}
