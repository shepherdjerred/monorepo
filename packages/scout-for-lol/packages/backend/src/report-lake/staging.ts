import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CachedLeaderboard,
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeStagingWritesTotal } from "#src/metrics/reports/report-lake.ts";
import {
  flattenCompetitionRankHistory,
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
  flattenPrematch,
} from "#src/report-lake/flatten.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";
import {
  type STAGING_TABLES,
  commitStagingGeneration,
  generationFile,
  snapshotStagingGenerations,
  type StagingGeneration,
  type StagingGenerationSnapshot,
  type StagingSource,
} from "#src/report-lake/staging/generations.ts";
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

export type ReportLakeStagingTable = (typeof STAGING_TABLES)[number];

export type StagingWriteResult = {
  success: boolean;
  files: readonly string[];
  generation?: StagingGeneration;
};

type StagingWriteOptions = { source?: StagingSource };

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
  const staged = await stageMatchGeneration(lakeDir, match);
  return staged.success;
}

export async function stageMatchGeneration(
  lakeDir: string,
  match: RawMatch,
  options: StagingWriteOptions = {},
): Promise<StagingWriteResult> {
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenMatch(match);
    const matchId = match.metadata.matchId;
    const generation = await commitStagingGeneration({
      lakeDir,
      projectionKind: "match",
      naturalId: stagingIdForMatch(matchId),
      observedAt: new Date(),
      ...(options.source === undefined ? {} : { source: options.source }),
      files: [
        { table: "matches", content: toNdjson(rows) },
        { table: "match_teams", content: toNdjson(flattenMatchTeams(match)) },
        {
          table: "match_team_bans",
          content: toNdjson(flattenMatchTeamBans(match)),
        },
      ],
    });
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "success" });
    reportLakeStagingWritesTotal.inc({
      table: "match_teams",
      status: "success",
    });
    reportLakeStagingWritesTotal.inc({
      table: "match_team_bans",
      status: "success",
    });
    return {
      success: true,
      generation,
      files: generation.tables.map((table) =>
        generationFile(generation, table),
      ),
    };
  } catch (error) {
    logger.warn(
      `Failed to write match staging file for ${match.metadata.matchId}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "failed" });
    return { success: false, files: [] };
  }
}

export async function writePrematchStagingFile(
  lakeDir: string,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
): Promise<boolean> {
  const staged = await stagePrematchGeneration(lakeDir, gameInfo, observedAt);
  return staged.success;
}

export async function stagePrematchGeneration(
  lakeDir: string,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
  options: StagingWriteOptions = {},
): Promise<StagingWriteResult> {
  const dedupeKey = `${gameInfo.platformId}:${gameInfo.gameId.toString()}`;
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenPrematch(gameInfo, observedAt);
    const generation = await commitStagingGeneration({
      lakeDir,
      projectionKind: "prematch",
      naturalId: stagingIdForPrematch(dedupeKey),
      observedAt,
      ...(options.source === undefined ? {} : { source: options.source }),
      files: [{ table: "prematch", content: toNdjson(rows) }],
    });
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "success" });
    return {
      success: true,
      generation,
      files: [generationFile(generation, "prematch")],
    };
  } catch (error) {
    logger.warn(`Failed to write prematch staging file for ${dedupeKey}`, {
      error,
    });
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "failed" });
    return { success: false, files: [] };
  }
}

export async function writeTimelineStagingFiles(
  lakeDir: string,
  timeline: RawTimeline,
  observedAt: Date,
): Promise<boolean> {
  const staged = await stageTimelineGeneration(lakeDir, timeline, observedAt);
  return staged.success;
}

export async function stageTimelineGeneration(
  lakeDir: string,
  timeline: RawTimeline,
  observedAt: Date,
  options: StagingWriteOptions = {},
): Promise<StagingWriteResult> {
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
    const generation = await commitStagingGeneration({
      lakeDir,
      projectionKind: "timeline",
      naturalId: stagingIdForTimeline(timeline.metadata.matchId),
      observedAt,
      ...(options.source === undefined ? {} : { source: options.source }),
      files: tables.map(({ table, rows }) => ({
        table,
        content: toNdjson(rows),
      })),
    });
    for (const { table } of tables) {
      reportLakeStagingWritesTotal.inc({ table, status: "success" });
    }
    return {
      success: true,
      generation,
      files: generation.tables.map((table) =>
        generationFile(generation, table),
      ),
    };
  } catch (error) {
    logger.warn(
      `Failed to write timeline staging files for ${timeline.metadata.matchId}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({
      table: "timeline_coverage",
      status: "failed",
    });
    return { success: false, files: [] };
  }
}

export async function writeCompetitionRankHistoryStagingFile(
  lakeDir: string,
  leaderboard: CachedLeaderboard,
  options: StagingWriteOptions = {},
): Promise<boolean> {
  try {
    await ensureLakeScaffold(lakeDir);
    const date = new Date(leaderboard.calculatedAt).toISOString().slice(0, 10);
    await commitStagingGeneration({
      lakeDir,
      projectionKind: "competition_rank_history",
      naturalId: stagingIdForCompetitionRankHistory(
        leaderboard.competitionId,
        date,
      ),
      observedAt: new Date(leaderboard.calculatedAt),
      ...(options.source === undefined ? {} : { source: options.source }),
      files: [
        {
          table: "competition_rank_history",
          content: toNdjson(flattenCompetitionRankHistory(leaderboard)),
        },
      ],
    });
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

export type StagingFileEntry = {
  file: string;
  stem: string;
  generation?: StagingGeneration;
};

function projectionKindForTable(table: ReportLakeStagingTable) {
  switch (table) {
    case "matches":
    case "match_teams":
    case "match_team_bans":
      return "match";
    case "prematch":
      return "prematch";
    case "competition_rank_history":
      return "competition_rank_history";
    case "timeline_events":
    case "timeline_event_participants":
    case "timeline_participant_frames":
    case "timeline_coverage":
      return "timeline";
  }
}

/** Legacy flat files stay readable while their last publisher drains. */
async function listLegacyStagingFiles(
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

export async function listStagingEntries(
  lakeDir: string,
  table: ReportLakeStagingTable,
  snapshot?: StagingGenerationSnapshot,
): Promise<StagingFileEntry[]> {
  const committed = snapshot ?? (await snapshotStagingGenerations(lakeDir));
  const kind = projectionKindForTable(table);
  const selected = committed.selected.filter(
    (generation) => generation.projectionKind === kind,
  );
  const selectedIds = new Set(
    selected.map((generation) => generation.naturalId),
  );
  const legacyFiles = await listLegacyStagingFiles(lakeDir, table);
  const legacy = legacyFiles
    .map((file) => ({ file, stem: path.basename(file, ".jsonl") }))
    .filter(({ stem }) => !selectedIds.has(stem));
  const generations = selected.flatMap((generation) =>
    generation.tables.includes(table)
      ? [
          {
            file: generationFile(generation, table),
            stem: generation.naturalId,
            generation,
          },
        ]
      : [],
  );
  return [...legacy, ...generations];
}

/** List absolute paths of one committed generation per key, plus legacy files. */
export async function listStagingFiles(
  lakeDir: string,
  table: ReportLakeStagingTable,
  snapshot?: StagingGenerationSnapshot,
): Promise<string[]> {
  const entries = await listStagingEntries(lakeDir, table, snapshot);
  return entries.map(({ file }) => file);
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
  const files = await listLegacyStagingFiles(lakeDir, table);
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
