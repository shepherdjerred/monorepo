import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { DuckDbColumnType } from "@scout-for-lol/data";
import {
  matchColumns,
  rawDocumentColumns,
  type ReportLakeLayout,
} from "#src/report-lake/schema-upgrade/layout.ts";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { copyNdjsonToParquet } from "#src/report-lake/parquet/copy-ndjson.ts";
import {
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "#src/report-lake/schema.ts";
import type { ReportLakeStagingTable } from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

const COMPACTION_TIMEOUT_MS = 30 * 60 * 1000;

export type StagingParseResult = {
  rowsByMonth: Map<string, object[]>;
  foldedIds: Set<string>;
  rows: number;
  skipped: number;
};

export function columnsForTable(
  table: ReportLakeStagingTable,
  layout: ReportLakeLayout,
): Record<string, DuckDbColumnType> {
  switch (table) {
    case "raw_documents":
      return rawDocumentColumns(layout);
    case "matches":
      return matchColumns(layout);
    case "match_teams":
      return MATCH_TEAM_LAKE_COLUMNS;
    case "match_team_bans":
      return MATCH_TEAM_BAN_LAKE_COLUMNS;
    case "prematch":
      return PREMATCH_LAKE_COLUMNS;
    case "competition_rank_history":
      return COMPETITION_RANK_HISTORY_LAKE_COLUMNS;
    case "timeline_events":
      return TIMELINE_EVENT_LAKE_COLUMNS;
    case "timeline_event_participants":
      return TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS;
    case "timeline_participant_frames":
      return TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS;
    case "timeline_coverage":
      return TIMELINE_COVERAGE_LAKE_COLUMNS;
  }
}

export async function writeFoldParquet({
  buildDir,
  buildId,
  table,
  staged,
  abortSignal,
  layout = "current",
}: {
  buildDir: string;
  buildId: string;
  table: ReportLakeStagingTable;
  staged: StagingParseResult;
  abortSignal?: AbortSignal | undefined;
  layout?: ReportLakeLayout;
}): Promise<void> {
  abortSignal?.throwIfAborted();
  const columns = columnsForTable(table, layout);
  for (const [month, rows] of staged.rowsByMonth) {
    const monthDir = path.join(buildDir, table, `month=${month}`);
    await mkdir(monthDir, { recursive: true });
    const tmpPath = path.join(buildDir, `${table}-${month}-fold.ndjson.tmp`);
    const writer = new NdjsonFileWriter(tmpPath, undefined, abortSignal);
    try {
      for (const row of rows)
        await writer.write(
          table === "raw_documents" && layout !== "current"
            ? { ...row, identity_map_json: "{}" }
            : row,
        );
      await writer.close();
      await withDuckDBConnection(
        async (session) => {
          await copyNdjsonToParquet(session, {
            sourcePath: tmpPath,
            outputDirectory: monthDir,
            columns,
            partitionByMonth: false,
            fileNamePrefix: `fold-${buildId}`,
          });
        },
        {
          timeoutMs: COMPACTION_TIMEOUT_MS,
          ...(abortSignal === undefined ? {} : { abortSignal }),
        },
      );
    } finally {
      await writer.abort();
      await rm(tmpPath, { force: true });
    }
  }
}
