import { expect, test } from "vitest";
import { ReportAiModelPreviewSummarySchema } from "@scout-for-lol/data";
import { inspectExploreToolResult } from "#src/explore/tool-inspection.ts";

test("records the total query row count in Explore trace details", () => {
  const preview = ReportAiModelPreviewSummarySchema.parse({
    columns: [{ key: "games", label: "Games", format: "integer" }],
    rows: Array.from({ length: 10 }, (_, index) => ({
      label: `Row ${index.toString()}`,
      values: [{ column: "games", value: index }],
    })),
    rowsReturned: 11,
    rowsScanned: 42,
    renderKind: "TABLE",
  });

  const inspection = inspectExploreToolResult(
    "run_report_query",
    { queryText: "FROM matches SELECT games" },
    {
      ok: true,
      message: "Returned 11 rows.",
      formattedQueryText: "FROM matches SELECT games",
      preview,
    },
  );

  expect(inspection.details).toEqual({
    kind: "execution",
    queryText: "FROM matches SELECT games",
    ok: true,
    rowsReturned: 11,
    rowsScanned: 42,
    renderKind: "TABLE",
  });
});
