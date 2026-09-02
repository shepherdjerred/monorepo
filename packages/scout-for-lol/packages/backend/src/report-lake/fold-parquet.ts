import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import {
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  duckDbColumnsSpec,
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

function columnsForTable(table: ReportLakeStagingTable) {
  switch (table) {
    case "matches":
      return MATCH_LAKE_COLUMNS;
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

export async function writeFoldParquet(
  buildDir: string,
  buildId: string,
  table: ReportLakeStagingTable,
  staged: StagingParseResult,
): Promise<void> {
  const columns = columnsForTable(table);
  for (const [month, rows] of staged.rowsByMonth) {
    const monthDir = path.join(buildDir, table, `month=${month}`);
    await mkdir(monthDir, { recursive: true });
    const tmpPath = path.join(buildDir, `${table}-${month}-fold.ndjson.tmp`);
    const writer = new NdjsonFileWriter(tmpPath);
    for (const row of rows) writer.write(row);
    await writer.close();
    const parquetPath = path.join(monthDir, `fold-${buildId}.parquet`);
    try {
      await withDuckDBConnection(
        async (session) => {
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(columns)})) TO '${parquetPath}' (FORMAT PARQUET)`,
            [tmpPath],
          );
        },
        { timeoutMs: COMPACTION_TIMEOUT_MS },
      );
    } finally {
      await unlink(tmpPath);
    }
  }
}
