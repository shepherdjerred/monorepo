import { stat } from "node:fs/promises";
import path from "node:path";
import { CRAWL_LOOKBACK_DAYS } from "#src/league/crawl/crawl-config.ts";
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
 *
 * Each file carries its ingest day (from its `ingest_day=` directory) and its
 * size, which is what global-scope pruning and the scan budget work from
 * without opening a file.
 */
export type CrawlFile = {
  path: string;
  ingestDay: string;
  bytes: number;
};

export type CrawlLakeFiles = {
  matches: CrawlFile[];
  matchTeams: CrawlFile[];
  matchTeamBans: CrawlFile[];
  timelineEvents: CrawlFile[];
  timelineEventParticipants: CrawlFile[];
  timelineCheckpoints: CrawlFile[];
};

export const NO_CRAWL_LAKE_FILES: CrawlLakeFiles = {
  matches: [],
  matchTeams: [],
  matchTeamBans: [],
  timelineEvents: [],
  timelineEventParticipants: [],
  timelineCheckpoints: [],
};

function ingestDayOf(file: string): string {
  const directory = path.basename(path.dirname(file));
  if (!directory.startsWith("ingest_day=")) {
    throw new Error(`Not a crawl partition file: ${file}`);
  }
  return directory.slice("ingest_day=".length);
}

async function globTable(
  buildDir: string,
  table: CrawlLakeTable,
): Promise<CrawlFile[]> {
  const glob = new Bun.Glob(`${table}/ingest_day=*/*.parquet`);
  const files: CrawlFile[] = [];
  for await (const file of glob.scan({ cwd: buildDir, absolute: true })) {
    const stats = await stat(file);
    files.push({ path: file, ingestDay: ingestDayOf(file), bytes: stats.size });
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
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
    timelineCheckpoints,
  ] = await Promise.all([
    globTable(buildDir, "matches_crawl"),
    globTable(buildDir, "match_teams_crawl"),
    globTable(buildDir, "match_team_bans_crawl"),
    globTable(buildDir, "timeline_events_crawl"),
    globTable(buildDir, "timeline_event_participants_crawl"),
    globTable(buildDir, "timeline_checkpoints_crawl"),
  ]);
  return {
    matches,
    matchTeams,
    matchTeamBans,
    timelineEvents,
    timelineEventParticipants,
    timelineCheckpoints,
  };
}

export function crawlFilePaths(files: readonly CrawlFile[]): string[] {
  return files.map((file) => file.path);
}

const DAY_MS = 86_400_000;

function dayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Only the crawl days that can hold a game created inside `range`.
 *
 * The crawl stores a game on the day it fetched it, never before the game was
 * played and never more than its 28-day lookback after, so a game created in
 * [start, end] lives in an ingest day in [start, end + 28 days]. Every other
 * day is skipped without being opened.
 */
export function pruneCrawlFilesToRange(
  crawl: CrawlLakeFiles,
  range: { start: Date; end: Date },
): CrawlLakeFiles {
  const first = dayOf(range.start.getTime());
  const last = dayOf(range.end.getTime() + CRAWL_LOOKBACK_DAYS * DAY_MS);
  const keep = (files: CrawlFile[]) =>
    files.filter((file) => file.ingestDay >= first && file.ingestDay <= last);
  return {
    matches: keep(crawl.matches),
    matchTeams: keep(crawl.matchTeams),
    matchTeamBans: keep(crawl.matchTeamBans),
    timelineEvents: keep(crawl.timelineEvents),
    timelineEventParticipants: keep(crawl.timelineEventParticipants),
    timelineCheckpoints: keep(crawl.timelineCheckpoints),
  };
}
