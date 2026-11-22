import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "./app.tsx";
import {
  formatSortAnnouncement,
  nextSortState,
  sortItems,
  type ColumnAccessor,
} from "./sort.ts";

type SampleRow = {
  readonly label: string;
  readonly score: number;
};

const SAMPLE_ACCESSORS: Readonly<
  Record<"label" | "score", ColumnAccessor<SampleRow>>
> = {
  label: { kind: "text", getValue: (row) => row.label },
  score: { kind: "number", getValue: (row) => row.score },
};

describe("accessible table sorting and shell landmarks", () => {
  test("starts ascending on new column and toggles direction on repeat click", () => {
    const first = nextSortState<"label" | "score">(null, "score");
    expect(first).toEqual({ column: "score", direction: "ascending" });

    const second = nextSortState(first, "score");
    expect(second).toEqual({ column: "score", direction: "descending" });

    const switched = nextSortState(second, "label");
    expect(switched).toEqual({ column: "label", direction: "ascending" });
  });

  test("sorts text with natural numeric Intl.Collator and numbers numerically", () => {
    const rows: readonly SampleRow[] = [
      { label: "Wave 10", score: 100 },
      { label: "Wave 2", score: 25 },
      { label: "wave 1", score: 250 },
    ];

    const byLabelAsc = sortItems(
      rows,
      { column: "label", direction: "ascending" },
      SAMPLE_ACCESSORS,
    );
    expect(byLabelAsc.map((row) => row.label)).toEqual([
      "wave 1",
      "Wave 2",
      "Wave 10",
    ]);

    const byScoreDesc = sortItems(
      rows,
      { column: "score", direction: "descending" },
      SAMPLE_ACCESSORS,
    );
    expect(byScoreDesc.map((row) => row.score)).toEqual([250, 100, 25]);

    expect(formatSortAnnouncement("Best Wave", "descending", 1)).toBe(
      "Sorted by Best Wave, descending, 1 row",
    );
    expect(formatSortAnnouncement("Best Wave", "ascending", 8)).toBe(
      "Sorted by Best Wave, ascending, 8 rows",
    );
  });

  test("renders accessible global shell landmarks and omits staff navigation for public viewers", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('href="#page-heading"');
    expect(html).toContain("Skip to main content");
    expect(html).toContain('aria-label="Primary"');
    expect(html).not.toContain('aria-label="Primary navigation"');
    expect(html).toContain('id="page-heading"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("/staff/network");
    expect(html).not.toContain("STAFF · TAILNET");
  });
});
