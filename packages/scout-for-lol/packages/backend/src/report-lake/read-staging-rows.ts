import {
  CompetitionRankHistoryLakeRowSchema,
  MatchLakeRowSchema,
  MatchTeamBanLakeRowSchema,
  MatchTeamLakeRowSchema,
  PrematchLakeRowSchema,
  TimelineCoverageLakeRowSchema,
  TimelineEventLakeRowSchema,
  TimelineEventParticipantLakeRowSchema,
  TimelineParticipantFrameLakeRowSchema,
} from "@scout-for-lol/data";
import { RawDocumentLakeRowSchema } from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/reports/report-lake.ts";
import type { ReportLakeProgress } from "#src/report-lake/compaction-types.ts";
import type { StagingParseResult } from "#src/report-lake/fold-parquet.ts";
import {
  listStagingEntries,
  type ReportLakeStagingTable,
} from "#src/report-lake/staging.ts";
import {
  generationFile,
  type StagingGenerationSnapshot,
} from "#src/report-lake/staging/generations.ts";

const logger = createLogger("report-lake-staging-reader");

function schemaForTable(table: ReportLakeStagingTable) {
  switch (table) {
    case "raw_documents":
      return RawDocumentLakeRowSchema;
    case "matches":
      return MatchLakeRowSchema;
    case "match_teams":
      return MatchTeamLakeRowSchema;
    case "match_team_bans":
      return MatchTeamBanLakeRowSchema;
    case "prematch":
      return PrematchLakeRowSchema;
    case "competition_rank_history":
      return CompetitionRankHistoryLakeRowSchema;
    case "timeline_events":
      return TimelineEventLakeRowSchema;
    case "timeline_event_participants":
      return TimelineEventParticipantLakeRowSchema;
    case "timeline_participant_frames":
      return TimelineParticipantFrameLakeRowSchema;
    case "timeline_coverage":
      return TimelineCoverageLakeRowSchema;
  }
}

type StagingRowSchema = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: { month: string } } | { success: false };
};

type ParsedStagingFile =
  | { kind: "invalid" }
  | { kind: "valid"; rows: { month: string; row: object }[] };

async function parseStagingFile(
  file: string,
  schema: StagingRowSchema,
): Promise<ParsedStagingFile> {
  const fileRows: { month: string; row: object }[] = [];
  const text = await Bun.file(file).text();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      return { kind: "invalid" };
    }
    const parsed = schema.safeParse(parsedLine);
    if (!parsed.success) return { kind: "invalid" };
    fileRows.push({ month: parsed.data.month, row: parsed.data });
  }
  return { kind: "valid", rows: fileRows };
}

/** Validate a whole committed projection before the fold reads any table. */
export async function validateStagingSnapshot(
  snapshot: StagingGenerationSnapshot,
): Promise<{
  snapshot: StagingGenerationSnapshot;
  skippedByTable: Map<ReportLakeStagingTable, number>;
}> {
  const selected: StagingGenerationSnapshot["selected"][number][] = [];
  const skippedByTable = new Map<ReportLakeStagingTable, number>();
  for (const generation of snapshot.selected) {
    let valid = true;
    for (const table of generation.tables) {
      const parsed = await parseStagingFile(
        generationFile(generation, table),
        schemaForTable(table),
      );
      if (parsed.kind === "invalid") valid = false;
    }
    if (valid) {
      selected.push(generation);
      continue;
    }
    logger.warn(
      "Committed staging generation failed validation; leaving whole projection for rebuild",
      {
        generationId: generation.generationId,
        projectionKind: generation.projectionKind,
        naturalId: generation.naturalId,
      },
    );
    for (const table of generation.tables) {
      reportLakeCompactionSkippedTotal.inc({ table });
      skippedByTable.set(table, (skippedByTable.get(table) ?? 0) + 1);
    }
  }
  return {
    snapshot: { captured: snapshot.captured, selected },
    skippedByTable,
  };
}

function addRows(
  rowsByMonth: Map<string, object[]>,
  fileRows: readonly { month: string; row: object }[],
): number {
  for (const { month, row } of fileRows) {
    const bucket = rowsByMonth.get(month) ?? [];
    bucket.push(row);
    rowsByMonth.set(month, bucket);
  }
  return fileRows.length;
}

export async function readStagingRows(
  lakeDir: string,
  table: ReportLakeStagingTable,
  options: {
    onProgress?: ((progress: ReportLakeProgress) => void) | undefined;
    snapshot?: StagingGenerationSnapshot;
    skippedGenerations?: number;
    abortSignal?: AbortSignal;
  } = {},
): Promise<StagingParseResult> {
  const schema = schemaForTable(table);
  const rowsByMonth = new Map<string, object[]>();
  const foldedIds = new Set<string>();
  let rows = 0;
  let skipped = options.skippedGenerations ?? 0;

  for (const { file, stem, generation } of await listStagingEntries(
    lakeDir,
    table,
    options.snapshot,
  )) {
    options.abortSignal?.throwIfAborted();
    const parsed = await parseStagingFile(file, schema);
    if (parsed.kind === "invalid") {
      if (generation !== undefined) {
        throw new Error(
          `Validated staging generation ${generation.generationId} changed before fold`,
        );
      }
      reportLakeCompactionSkippedTotal.inc({ table });
      skipped += 1;
      logger.warn("Staging file failed validation, leaving for rebuild", {
        file,
      });
      continue;
    }
    rows += addRows(rowsByMonth, parsed.rows);
    foldedIds.add(stem);
    options.onProgress?.({
      phase: "reading-staging",
      table,
      files: foldedIds.size + skipped,
      rows,
      skipped,
    });
  }
  return { rowsByMonth, foldedIds, rows, skipped };
}
