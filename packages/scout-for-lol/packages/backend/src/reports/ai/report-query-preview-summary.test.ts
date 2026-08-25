import { describe, expect, test } from "vitest";
import { ReportAiModelPreviewSummarySchema } from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { reportQueryPreviewSummary } from "#src/reports/ai/report-query-preview-summary.ts";
import type { ReportQueryResult } from "#src/reports/query-types.ts";

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";
const RANGE = {
  startDate: new Date("2026-07-09T00:00:00.000Z"),
  endDate: new Date("2026-08-08T00:00:00.000Z"),
};

describe("reportQueryPreviewSummary", () => {
  test("projects result values onto the strict AI preview contract", () => {
    const result: ReportQueryResult = {
      plan: compileScoutQl(
        `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} LIMIT 10 RENDER table`,
      ),
      columns: ["label", "games"],
      rows: [
        {
          label: "All",
          dimensions: [],
          keys: [],
          mentionIdentity: null,
          values: [
            {
              column: "games",
              value: null,
              comparisonValue: 12,
              absoluteDelta: -12,
              percentageDelta: -1,
              sampleSize: 20,
            },
          ],
        },
      ],
      rowsScanned: 20,
      range: RANGE,
      evidence: [
        {
          label: "All",
          games: 20,
          values: [{ column: "games", sampleSize: 20 }],
        },
      ],
    };

    expect(reportQueryPreviewSummary(result).rows).toEqual([
      {
        label: "All",
        games: 20,
        values: [{ column: "games", value: null }],
      },
    ]);
    expect(reportQueryPreviewSummary(result).visualizationRows).toEqual([
      {
        label: "All",
        games: 20,
        values: [{ column: "games", value: null }],
      },
    ]);
    expect(reportQueryPreviewSummary(result).rowsReturned).toBe(1);
  });

  test("keeps enough rows for frozen Discord visualizations", () => {
    const result: ReportQueryResult = {
      plan: compileScoutQl(
        `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY champion LIMIT 25 RENDER table`,
      ),
      columns: ["label", "games"],
      rows: Array.from({ length: 13 }, (_, index) => ({
        label: `Champion ${index.toString()}`,
        dimensions: [`Champion ${index.toString()}`],
        keys: [`Champion ${index.toString()}`],
        mentionIdentity: null,
        values: [{ column: "games", value: index }],
      })),
      rowsScanned: 13,
      range: RANGE,
    };

    const preview = reportQueryPreviewSummary(result);
    expect(preview.rows).toHaveLength(10);
    expect(preview.visualizationRows).toHaveLength(12);
    expect(preview.rowsReturned).toBe(13);
    expect(preview.visualizationRows.at(-1)?.label).toBe("Champion 11");
    expect(ReportAiModelPreviewSummarySchema.parse(preview)).not.toHaveProperty(
      "visualizationRows",
    );
  });
});
