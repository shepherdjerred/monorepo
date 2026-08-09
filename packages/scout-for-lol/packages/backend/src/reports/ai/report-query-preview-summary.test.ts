import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import { reportQueryPreviewSummary } from "#src/reports/ai/report-query-preview-summary.ts";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

describe("reportQueryPreviewSummary", () => {
  test("projects result values onto the strict AI preview contract", () => {
    const result: ReportQueryResult = {
      plan: parseAndCompile(
        "SELECT games FROM match_participants GROUP BY all LIMIT 10 RENDER table",
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
  });
});
