import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReportResultTable,
  sparklineSegments,
} from "#src/components/reports/report-result-table.tsx";

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
            games: 10,
            values: [{ column: "wins", sampleSize: 10 }],
          },
          {
            label: "Shared",
            games: 20,
            values: [{ column: "wins", sampleSize: 20 }],
          },
        ]}
      />,
    );

    expect(markup).toContain("1 (Based on 10 games)");
    expect(markup).toContain("2 (Based on 20 games)");
  });

  test("preserves missing buckets as gaps in sparklines", () => {
    expect(sparklineSegments([0.5, null, 0.7])).toEqual([
      "0.0,26.0 0.0,26.0",
      "120.0,2.0 120.0,2.0",
    ]);
  });

  test("annotates thin rate results once at table level", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable
        columns={[{ key: "win_rate", label: "Win rate", format: "percent" }]}
        rows={[{ label: "Aurora", values: [{ column: "win_rate", value: 1 }] }]}
        evidence={[
          {
            label: "Aurora",
            games: 4,
            values: [{ column: "win_rate", sampleSize: 4 }],
          },
        ]}
      />,
    );

    expect(markup).toContain("Based on 4 games");
    expect(markup).toContain(
      "Fewer than 10 games — treat this rate as indicative only.",
    );
    expect(markup.match(/Fewer than 10 games/g)).toHaveLength(1);
  });

  test("omits 'Based on X games' when a games column is present", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable
        columns={[
          { key: "label", label: "Champion", format: "text" },
          { key: "games", label: "Games", format: "integer" },
          { key: "win_rate", label: "Win rate", format: "percent" },
        ]}
        rows={[
          {
            label: "Ambessa",
            games: 17,
            values: [
              { column: "games", value: 17 },
              { column: "win_rate", value: 0.882 },
            ],
          },
        ]}
        evidence={[
          {
            label: "Ambessa",
            games: 17,
            values: [
              { column: "games", sampleSize: 17 },
              { column: "win_rate", sampleSize: 17 },
            ],
          },
        ]}
      />,
    );

    expect(markup).toContain("88.2%");
    expect(markup).not.toContain("Based on 17 games");
  });
});
