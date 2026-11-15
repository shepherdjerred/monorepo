import type { CrawlLakeTable } from "#src/report-lake/crawl/crawl-lake-schema.ts";
import {
  crawlManifestIsCurrent,
  readCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";

/**
 * The participant crawl's Parquet files in one published build, one sorted
 * list per crawl table. Crawl tables have no staging tier: the crawl inbox is
 * folded straight into Parquet.
 *
 * Every list is empty when the build holds no crawl data, or holds it at a
 * crawl schema this checkout does not read; a read never names a column the
 * files lack. Nothing reads these lists unless it asks for the `all`
 * population, so a tracked read is the same with or without crawl files.
 */
export type CrawlLakeFiles = {
  matches: string[];
  matchTeams: string[];
  matchTeamBans: string[];
  timelineEvents: string[];
  timelineEventParticipants: string[];
};

export const NO_CRAWL_LAKE_FILES: CrawlLakeFiles = {
  matches: [],
  matchTeams: [],
  matchTeamBans: [],
  timelineEvents: [],
  timelineEventParticipants: [],
};

async function globTable(
  buildDir: string,
  table: CrawlLakeTable,
): Promise<string[]> {
  const glob = new Bun.Glob(`${table}/ingest_day=*/*.parquet`);
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: buildDir, absolute: true })) {
    files.push(file);
  }
  return files.toSorted();
}

export async function resolveCrawlLakeFiles(
  buildDir: string,
): Promise<CrawlLakeFiles> {
  const manifest = await readCrawlManifest(buildDir);
  if (manifest === undefined || !crawlManifestIsCurrent(manifest)) {
    return NO_CRAWL_LAKE_FILES;
  }
  const [
    matches,
    matchTeams,
    matchTeamBans,
    timelineEvents,
    timelineEventParticipants,
  ] = await Promise.all([
    globTable(buildDir, "matches_crawl"),
    globTable(buildDir, "match_teams_crawl"),
    globTable(buildDir, "match_team_bans_crawl"),
    globTable(buildDir, "timeline_events_crawl"),
    globTable(buildDir, "timeline_event_participants_crawl"),
  ]);
  return {
    matches,
    matchTeams,
    matchTeamBans,
    timelineEvents,
    timelineEventParticipants,
  };
}
