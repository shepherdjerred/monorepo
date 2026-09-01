import {
  CompetitionRankHistoryLakeRowSchema,
  MatchLakeRowSchema,
  PrematchLakeRowSchema,
  TimelineCoverageLakeRowSchema,
  TimelineEventLakeRowSchema,
  TimelineEventParticipantLakeRowSchema,
  TimelineParticipantFrameLakeRowSchema,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/report-lake.ts";
import type { ReportLakeProgress } from "#src/report-lake/compaction-types.ts";
import type { StagingParseResult } from "#src/report-lake/fold-parquet.ts";
import {
  listStagingFiles,
  type ReportLakeStagingTable,
} from "#src/report-lake/staging.ts";

const logger = createLogger("report-lake-staging-reader");

function schemaForTable(table: ReportLakeStagingTable) {
  switch (table) {
    case "matches":
      return MatchLakeRowSchema;
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
  | { kind: "missing_name" }
  | { kind: "invalid" }
  | { kind: "valid"; stem: string; rows: { month: string; row: object }[] };

async function parseStagingFile(
  file: string,
  schema: StagingRowSchema,
): Promise<ParsedStagingFile> {
  const stem = file
    .split("/")
    .at(-1)
    ?.replace(/\.jsonl$/, "");
  if (stem === undefined) return { kind: "missing_name" };
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
  return { kind: "valid", stem, rows: fileRows };
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
  onProgress?: (progress: ReportLakeProgress) => void,
): Promise<StagingParseResult> {
  const schema = schemaForTable(table);
  const rowsByMonth = new Map<string, object[]>();
  const foldedIds = new Set<string>();
  let rows = 0;
  let skipped = 0;

  for (const file of await listStagingFiles(lakeDir, table)) {
    const parsed = await parseStagingFile(file, schema);
    if (parsed.kind === "missing_name") continue;
    if (parsed.kind === "invalid") {
      reportLakeCompactionSkippedTotal.inc({ table });
      skipped += 1;
      logger.warn("Staging file failed validation, leaving for rebuild", {
        file,
      });
      continue;
    }
    rows += addRows(rowsByMonth, parsed.rows);
    foldedIds.add(parsed.stem);
    onProgress?.({
      phase: "reading-staging",
      table,
      files: foldedIds.size + skipped,
      rows,
      skipped,
    });
  }
  return { rowsByMonth, foldedIds, rows, skipped };
}
