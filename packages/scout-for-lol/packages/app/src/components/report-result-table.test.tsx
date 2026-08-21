import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReportResultTable,
  sparklineSegments,
} from "#src/components/report-result-table.tsx";

describe("ReportResultTable", () => {
  test("keeps evidence aligned by row when labels repeat", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable
        columns={[
          { key: "label", label: "Player", format: "text" },
          { key: "wins", label: "Wins", format: "integer" },
        ]}
        rows={[
          { label: "Shared", values: [{ column: "wins", value: 1 }] },
          { label: "Shared", values: [{ column: "wins", value: 2 }] },
        ]}
        evidence={[
          {
            label: "Shared",
            values: [{ column: "wins", sampleSize: 10 }],
          },
          {
            label: "Shared",
            values: [{ column: "wins", sampleSize: 20 }],
          },
        ]}
      />,
    );

    expect(markup).toContain("1 (n=10)");
    expect(markup).toContain("2 (n=20)");
  });

  test("preserves missing buckets as gaps in sparklines", () => {
    expect(sparklineSegments([0.5, null, 0.7])).toEqual([
      "0.0,26.0 0.0,26.0",
      "120.0,2.0 120.0,2.0",
    ]);
  });
});
