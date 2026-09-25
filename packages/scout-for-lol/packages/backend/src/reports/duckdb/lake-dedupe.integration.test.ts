import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
  type TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import {
  buildTimelineParticipantFramesSource,
  type BoundParam,
} from "#src/reports/duckdb/lake.ts";
import { duckDbColumnsSpec } from "#src/report-lake/schema.ts";
import { TEST_LAKE_FILES } from "#src/testing/test-lake-files.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { frag, seq } from "#src/reports/duckdb/sql-fragment.ts";
import { testFrameRow } from "#src/testing/test-timeline-rows.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

/**
 * A timeline table with both a compacted parquet file and staged rows. The
 * compacted file is unique per key by construction, so the source reads it
 * without a window and dedupes only what was staged — keeping the rule the
 * window kept: a compacted row wins over a staged one with the same key.
 */

const GAME = new Date(Date.UTC(2026, 4, 4, 12));
const MIRA = testPuuid("dedupe-mira");

function frame(
  minute: number,
  totalGold: number,
): TimelineParticipantFrameLakeRow {
  return testFrameRow({
    matchId: "NA1_900",
    gameCreationAt: GAME,
    puuid: MIRA,
    participantId: 3,
    minute,
    totalGold,
    minions: 0,
    jungle: 0,
  });
}

async function writeNdjson(
  file: string,
  rows: TimelineParticipantFrameLakeRow[],
): Promise<void> {
  await Bun.write(
    file,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

const RowSchema = z.object({
  frame_index: z.number(),
  total_gold: z.number(),
});

describe("compacted-first timeline source", () => {
  test("keeps compacted rows, adds staged rows once, and never both", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scout-lake-dedupe-"));
    const compactedJson = path.join(dir, "compacted.jsonl");
    const parquet = path.join(dir, "frames.parquet");
    const staged = path.join(dir, "staged.jsonl");
    await writeNdjson(compactedJson, [frame(0, 500), frame(1, 900)]);
    // Minute 1 is also compacted; minute 2 is staged twice.
    await writeNdjson(staged, [frame(1, 111), frame(2, 1300), frame(2, 1300)]);

    const rows = await withDuckDBConnection(async (session) => {
      await session.run(
        `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS)})) TO '${parquet}' (FORMAT PARQUET)`,
        [compactedJson],
      );
      const source = buildTimelineParticipantFramesSource(
        {
          // Only the frame paths are read; the rest are never opened.
          ...TEST_LAKE_FILES,
          timelineParticipantFramesParquet: [parquet],
          timelineParticipantFramesStaging: [staged],
        },
        frag(""),
      );
      if (source === undefined) throw new Error("expected a source");
      const query = seq(
        "SELECT frame_index, total_gold FROM (",
        source,
        ") ORDER BY frame_index",
      );
      const bind = (params: BoundParam[]) =>
        params.map((param) =>
          param.kind === "list" ? session.list(param.values) : param.value,
        );
      return await session.run(query.sql, bind(query.params));
    });

    expect(rows.map((row) => RowSchema.parse(row))).toEqual([
      { frame_index: 0, total_gold: 500 },
      { frame_index: 1, total_gold: 900 },
      { frame_index: 2, total_gold: 1300 },
    ]);
  });
});
