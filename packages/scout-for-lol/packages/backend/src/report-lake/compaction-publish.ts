import path from "node:path";
import {
  reportLakeCompactionRowsTotal,
  reportLakeLastPublishTimestamp,
} from "#src/metrics/reports/report-lake.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import {
  CRAWL_LAKE_TABLES,
  crawlSchemaFingerprint,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import type { CrawlRowCounts } from "#src/report-lake/crawl/crawl-parquet-writer.ts";

export type CompactionSummary = {
  buildId: string;
  tier: "fold" | "rebuild";
  matchRows: number;
  rawDocumentRows?: number;
  matchTeamRows: number;
  matchTeamBanRows: number;
  prematchRows: number;
  accountRows: number;
  competitionRankHistoryRows: number;
  timelineEventRows: number;
  timelineEventParticipantRows: number;
  timelineParticipantFrameRows: number;
  timelineCoverageRows: number;
  /** Rows derived into `lane_results` (a fold's re-derivations, or all). */
  laneResultRows: number;
  skippedMatches: number;
  skippedPrematches: number;
  skippedCompetitionRankHistory: number;
  skippedTimelines: number;
  /** Crawl segments folded or re-derived into this build, and their rows. */
  crawl: { segments: number; rows: CrawlRowCounts };
  durationMs: number;
};

export async function writeCompactionManifest(
  buildDir: string,
  summary: Omit<CompactionSummary, "durationMs">,
): Promise<void> {
  await Bun.write(
    path.join(buildDir, "manifest.json"),
    JSON.stringify(
      {
        ...summary,
        schemaFingerprint: lakeSchemaFingerprint(),
        crawlSchemaFingerprint: crawlSchemaFingerprint(),
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export function publishCompactionMetrics(
  summary: Omit<CompactionSummary, "durationMs">,
): void {
  for (const [table, rows] of [
    ["raw_documents", summary.rawDocumentRows ?? 0],
    ["matches", summary.matchRows],
    ["match_teams", summary.matchTeamRows],
    ["match_team_bans", summary.matchTeamBanRows],
    ["prematch", summary.prematchRows],
    ["accounts", summary.accountRows],
    ["competition_rank_history", summary.competitionRankHistoryRows],
    ["timeline_events", summary.timelineEventRows],
    ["timeline_event_participants", summary.timelineEventParticipantRows],
    ["timeline_participant_frames", summary.timelineParticipantFrameRows],
    ["timeline_coverage", summary.timelineCoverageRows],
    ["lane_results", summary.laneResultRows],
  ] as const) {
    reportLakeCompactionRowsTotal.inc({ table, tier: summary.tier }, rows);
  }
  for (const table of CRAWL_LAKE_TABLES) {
    reportLakeCompactionRowsTotal.inc(
      { table, tier: summary.tier },
      summary.crawl.rows[table],
    );
  }
  reportLakeLastPublishTimestamp.set({ tier: summary.tier }, Date.now() / 1000);
}
