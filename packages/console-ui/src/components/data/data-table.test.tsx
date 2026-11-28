import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DataTable } from "@shepherdjerred/console-ui/components/data/data-table.tsx";
import {
  buildDisplayModel,
  formatDataTableCsv,
  formatDataTableJson,
  sortDataTableRows,
  type DataTableColumn,
  type DataTableExportColumn,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import {
  bucketBySeverity,
  groupBySeverity,
  severityRank,
} from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

type UpdateRow = {
  readonly id: string;
  readonly pkg: string;
  readonly deltaScore: number | null;
  readonly status: string;
  readonly summary: string;
  readonly severity: Severity;
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

const SEVERITY_CYCLE: readonly Severity[] = ["ok", "warning", "error", "info"];

function makeRows(count: number): UpdateRow[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `row-${String(idx + 1)}`,
    pkg: `pkg-${String(idx + 1)}`,
    deltaScore: idx % 5 === 0 ? null : idx * 3,
    status: idx % 2 === 0 ? "pending" : "ready",
    summary: `LLM notes for pkg-${String(idx + 1)}`,
    severity: SEVERITY_CYCLE[idx % SEVERITY_CYCLE.length] ?? "ok",
  }));
}

/** The visible text of each body row's header cell, in order. */
function rowHeaders(html: string): string[] {
  const body = html.slice(html.indexOf("<tbody"));
  return [...body.matchAll(/<th scope="row"[^>]*>([^<]*)</gu)].map(
    (match) => match[1] ?? "",
  );
}

describe("sortDataTableRows", () => {
  test("uses numeric-aware collation for strings and sorts nulls last in both directions", () => {
    const items: readonly {
      readonly name: string | null;
      readonly value: number | null;
    }[] = [
      { name: "node-10", value: 10 },
      { name: null, value: null },
      { name: "node-2", value: 2 },
      { name: "Alpha", value: 30 },
    ];
    const names = (direction: "ascending" | "descending") =>
      sortDataTableRows(items, (item) => item.name, direction).map(
        (item) => item.name,
      );
    const values = (direction: "ascending" | "descending") =>
      sortDataTableRows(items, (item) => item.value, direction).map(
        (item) => item.value,
      );
    expect(names("ascending")).toEqual(["Alpha", "node-2", "node-10", null]);
    expect(names("descending")).toEqual(["node-10", "node-2", "Alpha", null]);
    expect(values("ascending")).toEqual([2, 10, 30, null]);
    expect(values("descending")).toEqual([30, 10, 2, null]);
  });
});

describe("CSV and JSON export formatters", () => {
  test("escapes RFC 4180 CSV fields and serializes JSON cleanly", () => {
    const sample: readonly UpdateRow[] = [
      {
        id: "1",
        pkg: 'scope/pkg, "alpha"\nv2',
        deltaScore: 8,
        status: "ready",
        summary: "",
        severity: "ok",
      },
      {
        id: "2",
        pkg: "plain-pkg",
        deltaScore: null,
        status: "pending",
        summary: "",
        severity: "ok",
      },
    ];
    expect(formatDataTableCsv(sample, EXPORT_COLUMNS)).toBe(
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

describe("severity groups", () => {
  test("bucket worst first and keep the original order inside a bucket", () => {
    const items = [
      { id: "a", sev: "ok" },
      { id: "b", sev: "error" },
      { id: "c", sev: "warning" },
      { id: "d", sev: "error" },
      { id: "e", sev: "unknown" },
    ] as const;
    expect(
      bucketBySeverity(items, (item) => item.sev, severityRank).map(
        ([sev, members]) => [sev, members.map((item) => item.id)],
      ),
    ).toEqual([
      ["error", ["b", "d"]],
      ["warning", ["c"]],
      ["unknown", ["e"]],
      ["ok", ["a"]],
    ]);
  });

  test("the display model caps rows across groups and skips collapsed ones", () => {
    const rows = makeRows(12);
    const model = buildDisplayModel(rows, {
      rowKey: (row) => row.id,
      groupBy: groupBySeverity((row: UpdateRow) => row.severity),
      collapsed: new Set(["warning"]),
      isExpanded: (key) => key === "row-3",
      cap: 4,
    });
    expect(model.items.map((item) => `${item.kind}:${item.key}`)).toEqual([
      "group:group:error",
      "row:row-3",
      "detail:row-3",
      "row:row-7",
      "row:row-11",
      "group:group:warning",
      "group:group:info",
      "row:row-4",
    ]);
    expect(model.shown).toBe(4);
    // The collapsed warnings are outside the cap's total.
    expect(model.capTotal).toBe(9);
  });
});

describe("DataTable", () => {
  test("renders a named scroll region, sort buttons, live status, toolbar, detail row and row cap", () => {
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
        renderExpanded={(row) => <div className="notes">{row.summary}</div>}
        initialExpandedKeys={["row-29"]}
      />,
    );

    // Accessible region + caption + live status region
    const captionId = /<caption id="([^"]+)"/u.exec(html)?.[1];
    expect(captionId).toBeDefined();
    expect(html).toContain(
      `role="region" aria-labelledby="${captionId ?? ""}" tabindex="0"`,
    );
    expect(html).toContain('<span class="ui-sr-only" role="status"></span>');

    // Sortable headers are buttons with aria-sort; plain headers are text.
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('class="ui-sort"');
    expect(html).not.toContain(">State</span>");
    expect(html).toContain('<th scope="col">State</th>');

    // Toolbar: search input, filter radiogroup, count, CSV/JSON copy buttons
    expect(html).toContain('placeholder="Filter packages…"');
    expect(html).toContain('role="radiogroup" aria-label="Update state"');
    expect(html).toContain(
      '<span class="ui-filterbar-count" role="status">30 rows</span>',
    );
    expect(html).toContain("Copy CSV");
    expect(html).toContain("Copy JSON");
    // Nothing is filtered yet, so there is nothing to clear.
    expect(html).not.toContain("Clear filters");

    // Phone stack labels and the expanded detail row
    expect(html).toContain('data-label="Risk score"');
    expect(html).toContain('class="ui-table-child ui-datatable-detail"');
    expect(html).toContain('colSpan="4"');
    expect(html).toContain("LLM notes for pkg-29");
    expect(html).toContain('aria-label="Collapse details for pkg-29"');

    // Default initialCap = 25 caps 30 rows: "Showing 25 of 30 · Show all"
    expect(html).toContain("Showing 25 of 30");
    expect(html).toContain("Show all");
    expect(rowHeaders(html)).toHaveLength(25);
    // Highest risk first, nulls last.
    expect(rowHeaders(html).slice(0, 3)).toEqual([
      "pkg-30",
      "pkg-29",
      "pkg-28",
    ]);
    // Flush in its section: no frame of its own.
    expect(html).not.toContain("visual-");
  });

  test("filters rows via initialSearch and shows the matching empty message when none match", () => {
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
    expect(html).toContain('<tr class="ui-table-empty">');
    expect(html).toContain("0 of 4 rows");
    expect(html).toContain("Clear filters");
    expect(html).not.toContain("Show all");
    expect(html).toContain('class="ui-sr-only"');
  });

  test("search narrows rows case-blind and counts them", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Updates"
        rows={makeRows(30)}
        rowKey={(row) => row.id}
        columns={COLUMNS}
        searchText={(row) => row.pkg}
        initialSearch="PKG-2"
      />,
    );
    // pkg-2 and pkg-20 … pkg-29
    expect(rowHeaders(html)).toHaveLength(11);
    expect(html).toContain("11 of 30 rows");
  });

  test("the empty message names an empty data set", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Updates"
        rows={[]}
        rowKey={(row: UpdateRow) => row.id}
        columns={COLUMNS}
        emptyMessage="No updates are waiting."
      />,
    );
    expect(html).toContain("No updates are waiting.");
  });

  test("groups rows under severity headings, worst first, each with glyph, word and count", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Signals"
        rows={makeRows(8)}
        rowKey={(row) => row.id}
        columns={COLUMNS}
        groupBy={groupBySeverity((row: UpdateRow) => row.severity)}
      />,
    );
    const headings = [
      ...html.matchAll(
        /<tr class="ui-table-group"[^>]*><th scope="colgroup" colSpan="3">.*?data-sev="(\w+)".*?<span class="ui-glyph-label">(\w+)<\/span><\/span><span class="ui-count">(\d+)</gu,
      ),
    ].map((match) => [match[1], match[2], match[3]]);
    expect(headings).toEqual([
      ["error", "Error", "2"],
      ["warning", "Warning", "2"],
      ["info", "Info", "2"],
      ["ok", "OK", "2"],
    ]);
    expect(rowHeaders(html)).toEqual([
      "pkg-3",
      "pkg-7",
      "pkg-2",
      "pkg-6",
      "pkg-4",
      "pkg-8",
      "pkg-1",
      "pkg-5",
    ]);
  });

  test("selection draws a checkbox column with select-all and the bulk bar", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Updates"
        rows={makeRows(3)}
        rowKey={(row) => row.id}
        rowLabel={(row) => row.pkg}
        columns={COLUMNS}
        selectable
        selectedKeys={["row-2"]}
        bulkActions={(selected) => (
          <button type="button">{`Merge ${String(selected.length)}`}</button>
        )}
      />,
    );
    expect(html).toContain('aria-label="Select all rows"');
    expect(html).toContain('aria-label="Select pkg-2" checked=""');
    expect(html).not.toContain('aria-label="Select pkg-1" checked=""');
    expect(html).toContain("data-selected");
    expect(html).toContain('role="region" aria-label="Bulk actions"');
    expect(html).toContain("1 selected");
    expect(html).toContain("Merge 1");
  });

  test("marks the current row and offers the phone stack layout", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Updates"
        rows={makeRows(3)}
        rowKey={(row) => row.id}
        columns={COLUMNS}
        currentRowKey="row-2"
        stack
        sticky
      />,
    );
    expect(html).toContain(
      'data-key="row-2" data-current="" aria-current="true"',
    );
    expect(html).toContain('data-sticky=""');
    expect(html).toContain('data-stack=""');
  });
});
