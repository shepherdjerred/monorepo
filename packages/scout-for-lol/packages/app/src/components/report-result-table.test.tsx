import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportResultTable } from "#src/components/report-result-table.tsx";

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
});
