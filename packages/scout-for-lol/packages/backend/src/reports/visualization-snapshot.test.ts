import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import { buildVisualizationSnapshot } from "#src/reports/visualization-snapshot.ts";

describe("buildVisualizationSnapshot", () => {
  test("orders numeric patch buckets chronologically before assigning bounds", () => {
    const plan = parseAndCompile(
      "SELECT games FROM match_participants GROUP BY all ANALYZE LAST 90 DAYS BUCKET BY PATCH IN TIME ZONE 'UTC' ORDER BY games DESC RENDER line_chart WITH (y = games)",
    );
    const result: ReportQueryResult = {
      plan,
      columns: ["label", "games"],
      rows: [patchRow("26.10", 10), patchRow("26.9", 9)],
      rowsScanned: 19,
    };

    const snapshot = buildVisualizationSnapshot(
      result,
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series[0]?.points.map((point) => point.label)).toEqual([
      "26.9",
      "26.10",
    ]);
    expect(snapshot.annotations.map((annotation) => annotation.label)).toEqual([
      "Patch 26.10",
    ]);
  });

  test("caps non-temporal snapshot series without failing a valid table", () => {
    const plan = parseAndCompile(
      "SELECT champion, queue, games FROM match_participants GROUP BY champion, queue RENDER table",
    );
    const rows = Array.from(
      { length: 9 },
      (_, index): ReportResultRow => ({
        label: `Champion ${index.toString()} • solo`,
        dimensions: [`Champion ${index.toString()}`, "solo"],
        mentionIdentity: null,
        values: [{ column: "games", value: index + 1 }],
      }),
    );

    const snapshot = buildVisualizationSnapshot(
      { plan, columns: ["label", "games"], rows, rowsScanned: 9 },
      new Date("2026-08-08T00:00:00.000Z"),
    );

    expect(snapshot.series).toHaveLength(8);
  });
});

function patchRow(label: string, games: number): ReportResultRow {
  return {
    label,
    dimensions: [label],
    mentionIdentity: null,
    values: [{ column: "games", value: games }],
  };
}
