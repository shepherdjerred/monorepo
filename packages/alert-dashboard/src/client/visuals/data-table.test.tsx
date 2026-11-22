import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DataTable,
  formatDataTableCsv,
  formatDataTableJson,
  sortDataTableRows,
  type DataTableColumn,
  type DataTableExportColumn,
} from "./index.ts";

type UpdateRow = {
  readonly id: string;
  readonly pkg: string;
  readonly deltaScore: number | null;
  readonly status: string;
  readonly summary: string;
};

const COLUMNS: readonly DataTableColumn<UpdateRow>[] = [
  {
    key: "pkg",
    header: "Package",
    render: (row) => row.pkg,
    sortValue: (row) => row.pkg,
  },
  {
    key: "delta",
    header: "Risk score",
    align: "right",
    render: (row) => (row.deltaScore === null ? "—" : String(row.deltaScore)),
    sortValue: (row) => row.deltaScore,
  },
  {
    key: "status",
    header: "State",
    render: (row) => row.status,
  },
];

const EXPORT_COLUMNS: readonly DataTableExportColumn<UpdateRow>[] = [
  { key: "pkg", header: "Package", value: (row) => row.pkg },
  { key: "delta", header: 'Risk, "score"', value: (row) => row.deltaScore },
];

function makeRows(count: number): UpdateRow[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `row-${String(idx + 1)}`,
    pkg: `pkg-${String(idx + 1)}`,
    deltaScore: idx % 5 === 0 ? null : idx * 3,
    status: idx % 2 === 0 ? "pending" : "ready",
    summary: `LLM notes for pkg-${String(idx + 1)}`,
  }));
}

describe("sortDataTableRows", () => {
  it("uses numeric-aware collation for strings and sorts nulls last in both directions", () => {
    const items: readonly {
      readonly name: string | null;
      readonly value: number | null;
    }[] = [
      { name: "node-10", value: 10 },
      { name: null, value: null },
      { name: "node-2", value: 2 },
      { name: "Alpha", value: 30 },
    ];

    expect(
      sortDataTableRows(items, (item) => item.name, "ascending").map(
        (item) => item.name,
      ),
    ).toEqual(["Alpha", "node-2", "node-10", null]);

    expect(
      sortDataTableRows(items, (item) => item.name, "descending").map(
        (item) => item.name,
      ),
    ).toEqual(["node-10", "node-2", "Alpha", null]);

    expect(
      sortDataTableRows(items, (item) => item.value, "ascending").map(
        (item) => item.value,
      ),
    ).toEqual([2, 10, 30, null]);

    expect(
      sortDataTableRows(items, (item) => item.value, "descending").map(
        (item) => item.value,
      ),
    ).toEqual([30, 10, 2, null]);
  });
});

describe("CSV and JSON export formatters", () => {
  it("escapes RFC 4180 CSV fields and serializes JSON cleanly", () => {
    const sample: readonly UpdateRow[] = [
      {
        id: "1",
        pkg: 'scope/pkg, "alpha"\nv2',
        deltaScore: 8,
        status: "ready",
        summary: "",
      },
      {
        id: "2",
        pkg: "plain-pkg",
        deltaScore: null,
        status: "pending",
        summary: "",
      },
    ];
    const csv = formatDataTableCsv(sample, EXPORT_COLUMNS);
    expect(csv).toBe(
      'Package,"Risk, ""score"""\n"scope/pkg, ""alpha""\nv2",8\nplain-pkg,',
    );

    const parsed: unknown = JSON.parse(
      formatDataTableJson(sample, EXPORT_COLUMNS),
    );
    expect(parsed).toEqual([
      { pkg: 'scope/pkg, "alpha"\nv2', delta: 8 },
      { pkg: "plain-pkg", delta: null },
    ]);
  });
});

describe("DataTable", () => {
  it("renders accessible scrollable region, sort buttons, live status, toolbar, drawer, and row cap", () => {
    const rows = makeRows(30);
    const html = renderToStaticMarkup(
      <DataTable
        caption="Renovate updates"
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.pkg}
        columns={COLUMNS}
        defaultSort={{ key: "delta", direction: "descending" }}
        searchPlaceholder="Filter packages…"
        searchText={(row) => `${row.pkg} ${row.status}`}
        filters={[
          {
            key: "state",
            label: "Update state",
            value: "all",
            onChange: vi.fn(),
            options: [
              { value: "all", label: "All", count: 30 },
              { value: "ready", label: "Ready", count: 15 },
            ],
          },
        ]}
        exportFilename="renovate-updates"
        exportColumns={EXPORT_COLUMNS}
        renderExpanded={(row) => (
          <div className="delta-notes">{row.summary}</div>
        )}
        initialExpandedKeys={["row-29"]}
      />,
    );

    // Accessible region + caption + live status region
    const captionId = /<caption id="([^"]+)"/u.exec(html)?.[1];
    expect(captionId).toBeDefined();
    expect(html).toContain(
      `class="visual-table-region" role="region" aria-labelledby="${captionId ?? ""}" tabindex="0"`,
    );
    expect(html).toContain(
      '<div class="sr-only" role="status" aria-live="polite"></div>',
    );

    // Sortable vs non-sortable headers
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('class="visual-sort-btn"');
    expect(html).not.toContain(">State</span>");

    // Toolbar: search input, filter radiogroup, CSV/JSON copy buttons
    expect(html).toContain('placeholder="Filter packages…"');
    expect(html).toContain('role="radiogroup" aria-label="Update state"');
    expect(html).toContain("Copy CSV");
    expect(html).toContain("Copy JSON");

    // Mobile card data-label attributes and expanded row drawer
    expect(html).toContain('data-label="Package"');
    expect(html).toContain('data-label="Risk score"');
    expect(html).toContain('class="visual-expanded-row"');
    expect(html).toContain('colSpan="4"');
    expect(html).toContain("LLM notes for pkg-29");

    // Default initialCap = 25 caps 30 rows with "Show all 30" button
    expect(html).toContain("Show all 30");
  });

  it("filters rows via initialSearch and shows matching empty message when none match", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Updates"
        hideCaption
        rows={makeRows(4)}
        rowKey={(row) => row.id}
        columns={COLUMNS}
        searchText={(row) => row.pkg}
        initialSearch="does-not-exist"
      />,
    );
    expect(html).toContain("No matching rows.");
    expect(html).not.toContain("Show all");
  });
});
