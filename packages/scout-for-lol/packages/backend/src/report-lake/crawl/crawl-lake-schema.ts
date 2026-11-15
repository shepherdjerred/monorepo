import {
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data";
import { TIMELINE_EVENT_LAKE_COLUMNS } from "@scout-for-lol/data/model/reports/timeline-lake-columns.ts";
import { lakeSchemaFingerprintOf } from "#src/report-lake/schema.ts";

/**
 * The participant crawl's tables in the report lake.
 *
 * They are siblings of the tracked tables inside the same build and `CURRENT`
 * (`matches_crawl/`, …), partitioned by `ingest_day` — the UTC day the crawl
 * stored the match, which is also its raw segment's `dt=`. Partitioning by
 * ingest day rather than game month is what lets retention drop a whole
 * directory and lets a global-scope read prune by day.
 *
 * The column sets are covered by their own fingerprint, never by
 * `lakeSchemaFingerprint()`: a crawl column change re-derives the crawl days
 * from their raw segments on the next nightly rebuild instead of forcing a
 * tracked schema migration, and the tracked fingerprint stays exactly as it is.
 *
 * The participant, team and ban tables carry every tracked column, so a global
 * read can union a crawl row with a tracked row by name. The timeline tables
 * are narrower on purpose: the crawl keeps item and skill events only (see
 * `reduceTimeline`), with no frames, positions or kills, so they name only the
 * columns those events have and there is no `timeline_coverage` sibling.
 */

export const CRAWL_LAKE_TABLES = [
  "matches_crawl",
  "match_teams_crawl",
  "match_team_bans_crawl",
  "timeline_events_crawl",
  "timeline_event_participants_crawl",
] as const;

export type CrawlLakeTable = (typeof CRAWL_LAKE_TABLES)[number];

/** How long a crawled day stays in the lake. */
export const CRAWL_RETENTION_DAYS = 42;

const DAY_MS = 86_400_000;

/** The oldest ingest day still retained at `now`: today and the 41 days before it. */
export function crawlRetentionCutoffDay(now: Date): string {
  return new Date(now.getTime() - (CRAWL_RETENTION_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const INGEST_DAY = { ingest_day: "VARCHAR" } as const;

export const CRAWL_MATCH_LAKE_COLUMNS = {
  ...MATCH_LAKE_COLUMNS,
  ...INGEST_DAY,
  crawled_at: "TIMESTAMP",
  crawl_depth: "INTEGER",
  // The rank of the player the match was found through: one league-v4 lookup
  // per visit, so it describes the visit, not every participant.
  bracket_tier: "VARCHAR",
  bracket_division: "VARCHAR",
} as const satisfies Record<string, DuckDbColumnType>;

export const CRAWL_MATCH_TEAM_LAKE_COLUMNS = {
  ...MATCH_TEAM_LAKE_COLUMNS,
  ...INGEST_DAY,
} as const satisfies Record<string, DuckDbColumnType>;

export const CRAWL_MATCH_TEAM_BAN_LAKE_COLUMNS = {
  ...MATCH_TEAM_BAN_LAKE_COLUMNS,
  ...INGEST_DAY,
} as const satisfies Record<string, DuckDbColumnType>;

export const CRAWL_TIMELINE_EVENT_LAKE_COLUMNS = {
  event_id: TIMELINE_EVENT_LAKE_COLUMNS.event_id,
  match_id: TIMELINE_EVENT_LAKE_COLUMNS.match_id,
  ...INGEST_DAY,
  event_index: TIMELINE_EVENT_LAKE_COLUMNS.event_index,
  event_timestamp_ms: TIMELINE_EVENT_LAKE_COLUMNS.event_timestamp_ms,
  event_type: TIMELINE_EVENT_LAKE_COLUMNS.event_type,
  participant_id: TIMELINE_EVENT_LAKE_COLUMNS.participant_id,
  item_id: TIMELINE_EVENT_LAKE_COLUMNS.item_id,
  after_id: TIMELINE_EVENT_LAKE_COLUMNS.after_id,
  before_id: TIMELINE_EVENT_LAKE_COLUMNS.before_id,
  skill_slot: TIMELINE_EVENT_LAKE_COLUMNS.skill_slot,
  gold_gain: TIMELINE_EVENT_LAKE_COLUMNS.gold_gain,
  level_up_type: TIMELINE_EVENT_LAKE_COLUMNS.level_up_type,
} as const satisfies Record<string, DuckDbColumnType>;

export const CRAWL_TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS = {
  event_id: "VARCHAR",
  match_id: "VARCHAR",
  ...INGEST_DAY,
  participant_id: "INTEGER",
  puuid: "VARCHAR",
  role: "VARCHAR",
  role_index: "INTEGER",
} as const satisfies Record<string, DuckDbColumnType>;

export const CRAWL_LAKE_TABLE_COLUMNS: Readonly<
  Record<CrawlLakeTable, Readonly<Record<string, DuckDbColumnType>>>
> = {
  matches_crawl: CRAWL_MATCH_LAKE_COLUMNS,
  match_teams_crawl: CRAWL_MATCH_TEAM_LAKE_COLUMNS,
  match_team_bans_crawl: CRAWL_MATCH_TEAM_BAN_LAKE_COLUMNS,
  timeline_events_crawl: CRAWL_TIMELINE_EVENT_LAKE_COLUMNS,
  timeline_event_participants_crawl:
    CRAWL_TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
};

/** The fingerprint a build's crawl tables were written at (`crawl-manifest.json`). */
export function crawlSchemaFingerprint(): string {
  return lakeSchemaFingerprintOf(CRAWL_LAKE_TABLE_COLUMNS);
}

/** Row shapes, one per crawl table, as the fold writes them. */
export type CrawlTableRows = Record<CrawlLakeTable, object[]>;

export function emptyCrawlTableRows(): CrawlTableRows {
  return {
    matches_crawl: [],
    match_teams_crawl: [],
    match_team_bans_crawl: [],
    timeline_events_crawl: [],
    timeline_event_participants_crawl: [],
  };
}

/** `YYYY-MM-DD`, the only shape an ingest day may take. */
export const INGEST_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function ingestDayDirName(day: string): string {
  if (!INGEST_DAY_PATTERN.test(day)) {
    throw new Error(`Not an ingest day: ${day}`);
  }
  return `ingest_day=${day}`;
}
