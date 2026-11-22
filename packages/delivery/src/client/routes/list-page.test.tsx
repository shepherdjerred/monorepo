import { describe, expect, it } from "vitest";
import { renderWithRouter } from "#client/test-router.tsx";
import { FilterProblems, pageSummary } from "./list-page.tsx";

const DEPLOYMENTS: [string, string] = ["deployment", "deployments"];

describe("pageSummary", () => {
  it("says a full page holds the newest rows, never a total", () => {
    expect(
      pageSummary({
        count: 25,
        noun: DEPLOYMENTS,
        filtered: false,
        older: false,
        more: true,
      }),
    ).toBe(
      "Showing the 25 newest deployments. Older ones are on the next page.",
    );
  });

  it("says the last page shows all of what exists", () => {
    expect(
      pageSummary({
        count: 3,
        noun: DEPLOYMENTS,
        filtered: false,
        older: false,
        more: false,
      }),
    ).toBe("Showing all 3 deployments.");
    expect(
      pageSummary({
        count: 1,
        noun: DEPLOYMENTS,
        filtered: true,
        older: false,
        more: false,
      }),
    ).toBe("Showing all 1 deployment that match these filters.");
  });

  it("describes a page behind a cursor as older than the previous one", () => {
    expect(
      pageSummary({
        count: 25,
        noun: DEPLOYMENTS,
        filtered: false,
        older: true,
        more: true,
      }),
    ).toBe("Showing 25 deployments older than the previous page.");
  });

  it("says when nothing matches", () => {
    expect(
      pageSummary({
        count: 0,
        noun: DEPLOYMENTS,
        filtered: true,
        older: false,
        more: false,
      }),
    ).toBe("No deployments match these filters.");
    expect(
      pageSummary({
        count: 0,
        noun: DEPLOYMENTS,
        filtered: false,
        older: false,
        more: false,
      }),
    ).toBe("No deployments yet.");
  });
});

describe("FilterProblems", () => {
  it("states the problem in a live region with a link to clear the filters", () => {
    const html = renderWithRouter(
      <FilterProblems
        problems={["“bogus” is not a status. Choose one of queued, running."]}
        clearTo="/deployments"
      />,
    );
    expect(html).toContain('role="status" class="notice error"');
    expect(html).toContain("Choose one of queued, running.");
    expect(html).toContain('href="/deployments"');
    expect(html).toContain("Clear filters");
  });
});
