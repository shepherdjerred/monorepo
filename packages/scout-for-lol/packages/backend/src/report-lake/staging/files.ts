import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  generationFile,
  snapshotStagingGenerations,
  type STAGING_TABLES,
  type StagingGeneration,
  type StagingGenerationSnapshot,
} from "#src/report-lake/staging/generations.ts";
import {
  competitionRankHistoryStagingDir,
  matchTeamBansStagingDir,
  matchTeamsStagingDir,
  matchesStagingDir,
  prematchStagingDir,
  timelineCoverageStagingDir,
  timelineEventParticipantsStagingDir,
  timelineEventsStagingDir,
  timelineParticipantFramesStagingDir,
} from "#src/report-lake/paths.ts";
type ReportLakeStagingTable = (typeof STAGING_TABLES)[number];

export function stagingDirectory(
  lakeDir: string,
  table: ReportLakeStagingTable,
): string {
  switch (table) {
    case "raw_documents":
      return path.join(lakeDir, "raw-documents-recent");
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

export type StagingFileEntry = {
  file: string;
  stem: string;
  generation?: StagingGeneration;
};

function projectionKindForTable(table: ReportLakeStagingTable) {
  switch (table) {
    case "raw_documents":
      return null;
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
  const selected = committed.selected.filter((generation) =>
    kind === null
      ? generation.tables.includes(table)
      : generation.projectionKind === kind,
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
