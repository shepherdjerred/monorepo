import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HistoryFilters,
  clearHistoryFilterParams,
  hasActiveHistoryFilters,
  historyInput,
} from "./history-page.tsx";

describe("HistoryPage filter controls", () => {
  it("parses URL search params and detects active filters", () => {
    const empty = new URLSearchParams();
    expect(hasActiveHistoryFilters(empty)).toBe(false);
    expect(historyInput(empty)).toMatchObject({
      success: true,
      data: { limit: 100 },
    });

    const filtered = new URLSearchParams(
      "type=opened&severity=critical&namespace=temporal&keep=1",
    );
    expect(hasActiveHistoryFilters(filtered)).toBe(true);
    expect(historyInput(filtered)).toMatchObject({
      success: true,
      data: {
        limit: 100,
        type: "opened",
        severity: "critical",
        namespace: "temporal",
      },
    });

    const cleared = clearHistoryFilterParams(filtered);
    expect(hasActiveHistoryFilters(cleared)).toBe(false);
    expect(cleared.get("keep")).toBe("1");
  });

  it("renders Clear filters button only when filtered", () => {
    const noop = vi.fn();
    const unfilteredHtml = renderToStaticMarkup(
      createElement(HistoryFilters, {
        params: new URLSearchParams(),
        onUpdate: noop,
        onClear: noop,
      }),
    );
    expect(unfilteredHtml).not.toContain("Clear filters");

    const filteredHtml = renderToStaticMarkup(
      createElement(HistoryFilters, {
        params: new URLSearchParams("severity=warning&type=resolved"),
        onUpdate: noop,
        onClear: noop,
      }),
    );
    expect(filteredHtml).toContain("Clear filters");
  });
});
