import path from "node:path";
import {
  reportLakeCompactionRowsTotal,
  reportLakeLastPublishTimestamp,
} from "#src/metrics/report-lake.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

export type CompactionSummary = {
  buildId: string;
  tier: "fold" | "rebuild";
  matchRows: number;
  matchTeamRows: number;
  matchTeamBanRows: number;
  prematchRows: number;
  accountRows: number;
  competitionRankHistoryRows: number;
  timelineEventRows: number;
  timelineEventParticipantRows: number;
  timelineParticipantFrameRows: number;
  timelineCoverageRows: number;
  skippedMatches: number;
  skippedPrematches: number;
  skippedCompetitionRankHistory: number;
  skippedTimelines: number;
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
  ] as const) {
    reportLakeCompactionRowsTotal.inc({ table, tier: summary.tier }, rows);
  }
  reportLakeLastPublishTimestamp.set({ tier: summary.tier }, Date.now() / 1000);
}
