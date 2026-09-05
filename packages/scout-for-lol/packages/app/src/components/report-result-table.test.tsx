import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import type { ReportResultColumn } from "@scout-for-lol/data";

describe("ReportResultTable", () => {
  const columns: ReportResultColumn[] = [
    { key: "label", label: "Player", format: "text" },
    { key: "win_rate", label: "Win rate", format: "percent" },
  ];

  const rows = [
    {
      label: "Faker",
      values: [{ column: "win_rate", value: 0.65 }],
    },
    {
      label: "Chovy",
      values: [{ column: "win_rate", value: 0.62 }],
    },
  ];

  test("renders standard static table when interactive is false", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable columns={columns} rows={rows} />,
    );
    expect(markup).toContain("Player");
    expect(markup).toContain("Win rate");
    expect(markup).toContain("Faker");
    expect(markup).toContain("65.0%");
    expect(markup).toContain("Chovy");
    expect(markup).not.toContain("Search rows…");
    expect(markup).not.toContain("Copy CSV");
  });

  test("renders search input, sort buttons, and export buttons when interactive is true", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable columns={columns} rows={rows} interactive={true} />,
    );
    expect(markup).toContain("Search rows…");
    expect(markup).toContain("Copy CSV");
    expect(markup).toContain("CSV");
    expect(markup).toContain("Faker");
    expect(markup).toContain("Chovy");
    expect(markup).toContain("<button");
  });

  test("gives drill-down rows keyboard semantics", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable
        columns={columns}
        rows={rows}
        onRowClick={(row) => row.label}
      />,
    );

    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Explore Faker"');
  });

  test("renders empty state when no rows are provided", () => {
    const markup = renderToStaticMarkup(
      <ReportResultTable columns={columns} rows={[]} />,
    );
    expect(markup).toContain("No rows matched this query.");
  });
});
