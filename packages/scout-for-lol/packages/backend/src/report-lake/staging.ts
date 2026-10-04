import {
  stagingDirectory,
  listStagingEntries as listEntries,
  listStagingFiles as listFiles,
  removeFoldedStagingFiles as removeFiles,
} from "#src/report-lake/staging/files.ts";
import path from "node:path";
import { rawDocumentRow } from "#src/report-lake/staging/raw-documents.ts";
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
  type StagingGeneration,
  type StagingSource,
} from "#src/report-lake/staging/generations.ts";
import {
  competitionRankHistoryStagingDir,
  ensureLakeScaffold,
  matchTeamBansStagingDir,
  matchTeamsStagingDir,
  matchesStagingDir,
  prematchStagingDir,
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

export type StagingFileEntry = Awaited<ReturnType<typeof listEntries>>[number];

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
        {
          table: "raw_documents",
          content: toNdjson([
            rawDocumentRow({
              kind: "match",
              matchId,
              document: match,
              capturedAt: new Date(),
              ...options,
            }),
          ]),
        },
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
      files: [
        { table: "prematch", content: toNdjson(rows) },
        {
          table: "raw_documents",
          content: toNdjson([
            rawDocumentRow({
              kind: "prematch",
              matchId: `${gameInfo.platformId}_${String(gameInfo.gameId)}`,
              document: gameInfo,
              capturedAt: observedAt,
              ...options,
            }),
          ]),
        },
      ],
    });
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "success" });
    return {
      success: true,
      generation,
      files: generation.tables.map((table) =>
        generationFile(generation, table),
      ),
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
    {
      table: "raw_documents" as const,
      rows: [
        rawDocumentRow({
          kind: "timeline",
          matchId: timeline.metadata.matchId,
          document: timeline,
          capturedAt: observedAt,
          ...options,
        }),
      ],
    },
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

export async function listStagingEntries(
  ...args: Parameters<typeof listEntries>
) {
  return await listEntries(...args);
}
export async function listStagingFiles(...args: Parameters<typeof listFiles>) {
  return await listFiles(...args);
}
export async function removeFoldedStagingFiles(
  ...args: Parameters<typeof removeFiles>
) {
  return await removeFiles(...args);
}
