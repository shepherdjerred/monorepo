import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CachedLeaderboard,
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeStagingWritesTotal } from "#src/metrics/report-lake.ts";
import {
  flattenCompetitionRankHistory,
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
  flattenPrematch,
} from "#src/report-lake/flatten.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";
import {
  competitionRankHistoryStagingDir,
  ensureLakeScaffold,
  matchTeamBansStagingDir,
  matchTeamsStagingDir,
  matchesStagingDir,
  prematchStagingDir,
  timelineCoverageStagingDir,
  timelineEventParticipantsStagingDir,
  timelineEventsStagingDir,
  timelineParticipantFramesStagingDir,
} from "#src/report-lake/paths.ts";

const logger = createLogger("report-lake-staging");

/**
 * Ingest-time staging: one NDJSON file per match, prematch observation, or
 * daily competition leaderboard,
 * named by its natural id so re-ingest is an idempotent whole-file overwrite
 * (Bun.write) — no append races, no torn lines. The DuckDB engine unions
 * these files with the published parquet build (deduped, parquet preferred)
 * so a match is queryable seconds after ingest instead of after the next
 * compaction; compaction folds them into parquet and deletes them.
 *
 * Staging writes MUST never fail ingest — they are redundant with the nightly
 * rebuild, which reads the same authoritative data back out of S3.
 * Callers get a boolean and a metric, not an exception.
 */

function sanitizeFileStem(stem: string): string {
  return stem.replaceAll(/[^\w.-]/g, "_");
}

export type ReportLakeStagingTable =
  | "matches"
  | "match_teams"
  | "match_team_bans"
  | "prematch"
  | "competition_rank_history"
  | "timeline_events"
  | "timeline_event_participants"
  | "timeline_participant_frames"
  | "timeline_coverage";

export function matchStagingFilePath(lakeDir: string, matchId: string): string {
  return path.join(
    matchesStagingDir(lakeDir),
    `${sanitizeFileStem(matchId)}.jsonl`,
  );
}

export function matchTeamStagingFilePath(
  lakeDir: string,
  matchId: string,
): string {
  return path.join(
    matchTeamsStagingDir(lakeDir),
    `${sanitizeFileStem(matchId)}.jsonl`,
  );
}

export function matchTeamBanStagingFilePath(
  lakeDir: string,
  matchId: string,
): string {
  return path.join(
    matchTeamBansStagingDir(lakeDir),
    `${sanitizeFileStem(matchId)}.jsonl`,
  );
}

export function prematchStagingFilePath(
  lakeDir: string,
  dedupeKey: string,
): string {
  return path.join(
    prematchStagingDir(lakeDir),
    `${sanitizeFileStem(dedupeKey)}.jsonl`,
  );
}

export function competitionRankHistoryStagingFilePath(
  lakeDir: string,
  leaderboard: CachedLeaderboard,
): string {
  const date = new Date(leaderboard.calculatedAt).toISOString().slice(0, 10);
  return path.join(
    competitionRankHistoryStagingDir(lakeDir),
    `${stagingIdForCompetitionRankHistory(leaderboard.competitionId, date)}.jsonl`,
  );
}

function stagingDirectory(
  lakeDir: string,
  table: ReportLakeStagingTable,
): string {
  switch (table) {
    case "matches":
      return matchesStagingDir(lakeDir);
    case "match_teams":
      return matchTeamsStagingDir(lakeDir);
    case "match_team_bans":
      return matchTeamBansStagingDir(lakeDir);
    case "prematch":
      return prematchStagingDir(lakeDir);
    case "competition_rank_history":
      return competitionRankHistoryStagingDir(lakeDir);
    case "timeline_events":
      return timelineEventsStagingDir(lakeDir);
    case "timeline_event_participants":
      return timelineEventParticipantsStagingDir(lakeDir);
    case "timeline_participant_frames":
      return timelineParticipantFramesStagingDir(lakeDir);
    case "timeline_coverage":
      return timelineCoverageStagingDir(lakeDir);
  }
}

export function timelineStagingFilePath(
  lakeDir: string,
  table: Extract<ReportLakeStagingTable, `timeline_${string}`>,
  matchId: string,
): string {
  return path.join(
    stagingDirectory(lakeDir, table),
    `${sanitizeFileStem(matchId)}.jsonl`,
  );
}

function toNdjson(rows: object[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export async function writeMatchStagingFile(
  lakeDir: string,
  match: RawMatch,
): Promise<boolean> {
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenMatch(match);
    const matchId = match.metadata.matchId;
    await Promise.all([
      Bun.write(matchStagingFilePath(lakeDir, matchId), toNdjson(rows)),
      Bun.write(
        matchTeamStagingFilePath(lakeDir, matchId),
        toNdjson(flattenMatchTeams(match)),
      ),
      Bun.write(
        matchTeamBanStagingFilePath(lakeDir, matchId),
        toNdjson(flattenMatchTeamBans(match)),
      ),
    ]);
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "success" });
    reportLakeStagingWritesTotal.inc({
      table: "match_teams",
      status: "success",
    });
    reportLakeStagingWritesTotal.inc({
      table: "match_team_bans",
      status: "success",
    });
    return true;
  } catch (error) {
    logger.warn(
      `Failed to write match staging file for ${match.metadata.matchId}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "failed" });
    return false;
  }
}

export async function writePrematchStagingFile(
  lakeDir: string,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
): Promise<boolean> {
  const dedupeKey = `${gameInfo.platformId}:${gameInfo.gameId.toString()}`;
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenPrematch(gameInfo, observedAt);
    if (rows.length === 0) {
      // Every participant was privacy-scrubbed; nothing to stage.
      return true;
    }
    await Bun.write(
      prematchStagingFilePath(lakeDir, dedupeKey),
      toNdjson(rows),
    );
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "success" });
    return true;
  } catch (error) {
    logger.warn(`Failed to write prematch staging file for ${dedupeKey}`, {
      error,
    });
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "failed" });
    return false;
  }
}

export async function writeTimelineStagingFiles(
  lakeDir: string,
  timeline: RawTimeline,
  observedAt: Date,
): Promise<boolean> {
  const flattened = flattenTimeline(timeline, observedAt);
  const tables = [
    { table: "timeline_events" as const, rows: flattened.events },
    {
      table: "timeline_event_participants" as const,
      rows: flattened.eventParticipants,
    },
    {
      table: "timeline_participant_frames" as const,
      rows: flattened.participantFrames,
    },
    { table: "timeline_coverage" as const, rows: flattened.coverage },
  ];
  try {
    await ensureLakeScaffold(lakeDir);
    for (const { table, rows } of tables) {
      if (rows.length > 0) {
        await Bun.write(
          timelineStagingFilePath(lakeDir, table, timeline.metadata.matchId),
          toNdjson(rows),
        );
      }
      reportLakeStagingWritesTotal.inc({ table, status: "success" });
    }
    return true;
  } catch (error) {
    logger.warn(
      `Failed to write timeline staging files for ${timeline.metadata.matchId}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({
      table: "timeline_coverage",
      status: "failed",
    });
    return false;
  }
}

export async function writeCompetitionRankHistoryStagingFile(
  lakeDir: string,
  leaderboard: CachedLeaderboard,
): Promise<boolean> {
  try {
    await ensureLakeScaffold(lakeDir);
    await Bun.write(
      competitionRankHistoryStagingFilePath(lakeDir, leaderboard),
      toNdjson(flattenCompetitionRankHistory(leaderboard)),
    );
    reportLakeStagingWritesTotal.inc({
      table: "competition_rank_history",
      status: "success",
    });
    return true;
  } catch (error) {
    logger.warn(
      `Failed to write rank-history staging file for competition ${leaderboard.competitionId.toString()}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({
      table: "competition_rank_history",
      status: "failed",
    });
    return false;
  }
}

/** List absolute paths of all staging files for a table. */
export async function listStagingFiles(
  lakeDir: string,
  table: ReportLakeStagingTable,
): Promise<string[]> {
  const dir = stagingDirectory(lakeDir, table);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted()
    .map((name) => path.join(dir, name));
}

/**
 * Delete staging files whose natural ids were provably folded into a
 * published build. Ids not in the folded set are left for the next run.
 */
export async function removeFoldedStagingFiles(
  lakeDir: string,
  table: ReportLakeStagingTable,
  foldedIds: Set<string>,
): Promise<number> {
  const files = await listStagingFiles(lakeDir, table);
  let removed = 0;
  for (const file of files) {
    const stem = file
      .split("/")
      .at(-1)
      ?.replace(/\.jsonl$/, "");
    if (stem !== undefined && foldedIds.has(stem)) {
      await unlink(file);
      removed += 1;
    }
  }
  return removed;
}

/** The sanitized natural id a staging file would use — for fold bookkeeping. */
export function stagingIdForMatch(matchId: string): string {
  return sanitizeFileStem(matchId);
}

export function stagingIdForPrematch(dedupeKey: string): string {
  return sanitizeFileStem(dedupeKey);
}

export function stagingIdForCompetitionRankHistory(
  competitionId: number,
  date: string,
): string {
  return sanitizeFileStem(`${competitionId.toString()}_${date}`);
}

export function stagingIdForTimeline(matchId: string): string {
  return sanitizeFileStem(matchId);
}
