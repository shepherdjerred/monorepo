import { describe, expect, test } from "bun:test";
import {
  parseAndCompile,
  ReportAiModelPreviewSummarySchema,
} from "@scout-for-lol/data";
import { reportQueryPreviewSummary } from "#src/reports/ai/report-query-preview-summary.ts";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

describe("reportQueryPreviewSummary", () => {
  test("projects result values onto the strict AI preview contract", () => {
    const result: ReportQueryResult = {
      plan: parseAndCompile(
        "SELECT games FROM match_participants GROUP BY all DURING LAST 30 DAYS LIMIT 10 RENDER table",
      ),
      columns: ["games"],
      rows: [
        {
          label: "All",
          dimensions: [],
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
    };

    expect(reportQueryPreviewSummary(result).rows).toEqual([
      {
        label: "All",
        values: [{ column: "games", value: null }],
      },
    ]);
    expect(reportQueryPreviewSummary(result).visualizationRows).toEqual([
      {
        label: "All",
        values: [{ column: "games", value: null }],
      },
    ]);
    expect(reportQueryPreviewSummary(result).rowsReturned).toBe(1);
  });

  test("keeps enough rows for frozen Discord visualizations", () => {
    const result: ReportQueryResult = {
      plan: parseAndCompile(
        "SELECT games FROM match_participants GROUP BY champion LIMIT 25 RENDER table",
      ),
      columns: ["games"],
      rows: Array.from({ length: 13 }, (_, index) => ({
        label: `Champion ${index.toString()}`,
        dimensions: [],
        mentionIdentity: null,
        values: [{ column: "games", value: index }],
      })),
      rowsScanned: 13,
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
