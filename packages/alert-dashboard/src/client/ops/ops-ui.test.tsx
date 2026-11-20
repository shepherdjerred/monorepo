import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Metric } from "@shepherdjerred/ops-model/snapshot.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChangeTimeline, MetricTile, StatusBanner } from "./ops-ui.tsx";
import type { ChangeView } from "#shared/ops-schema";

function tile(severity: Severity): string {
  const metric: Metric = {
    id: "disk",
    source: "maintenance",
    label: "Fullest disk",
    value: 0.84,
    unit: "ratio",
    severity,
  };
  return renderToStaticMarkup(createElement(MetricTile, { metric }));
}

describe("MetricTile", () => {
  it.each(["ok", "info"] as const)("leaves an %s metric plain", (severity) => {
    expect(tile(severity)).toBe(
      `<div class="metric metric-${severity}"><span>Fullest disk</span><strong>84%</strong></div>`,
    );
  });

  it.each(["warning", "error", "unknown"] as const)(
    "flags a metric at %s with an icon and the word",
    (severity) => {
      const html = tile(severity);
      expect(html).toContain(`class="metric metric-${severity}"`);
      expect(html).toContain("<strong>84%</strong>");
      // The icon is decoration; the word is what a screen reader gets.
      expect(html).toMatch(/<svg[^>]*class="[^"]*metric-flag"/u);
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/u);
      expect(html).toContain(`<span class="sr-only">${severity}</span>`);
    },
  );
});

describe("StatusBanner", () => {
  it("labels its region and puts the meta line under the summary", () => {
    const html = renderToStaticMarkup(
      <StatusBanner
        severity="warning"
        summary="2 areas need attention"
        label="Status"
      >
        Nov 13 – Nov 20
      </StatusBanner>,
    );
    expect(html).toContain(
      '<section class="status-banner status-warning" aria-label="Status">',
    );
    expect(html).toContain("Warning");
    expect(html).toContain(
      '<p class="status-summary">2 areas need attention</p><p class="status-meta">Nov 13 – Nov 20</p>',
    );
  });
});

function changes(count: number): ChangeView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `change-${String(index)}`,
    source: "github",
    externalId: `pr:${String(index)}`,
    kind: "merge",
    title: `Merged #${String(index)}`,
    occurredAt: "2026-08-01T00:00:00.000Z",
    severity: "info",
  }));
}

function timeline(list: readonly ChangeView[], cap?: number): string {
  return renderToStaticMarkup(
    createElement(ChangeTimeline, {
      changes: list,
      ...(cap === undefined ? {} : { cap }),
    }),
  );
}

function rows(html: string): number {
  return html.split('<li class="change ').length - 1;
}

describe("ChangeTimeline", () => {
  it("says so when nothing changed", () => {
    expect(timeline([])).toBe('<p class="list-empty">No changes recorded.</p>');
  });

  it("shows up to seventeen changes without a toggle", () => {
    const html = timeline(changes(17));
    expect(rows(html)).toBe(17);
    expect(html).not.toContain("list-toggle");
  });

  it("caps a longer timeline at fifteen behind a labelled button", () => {
    const html = timeline(changes(50));
    expect(rows(html)).toBe(15);
    expect(html).toContain("Merged #14");
    expect(html).not.toContain("Merged #15");
    const listId = /<ol class="change-list" id="([^"]+)"/u.exec(html)?.[1];
    expect(listId).toBeDefined();
    expect(html).toContain(
      `<button type="button" class="list-toggle" aria-expanded="false" aria-controls="${listId ?? ""}">Show 35 more`,
    );
  });

  it("honours a caller's cap", () => {
    const html = timeline(changes(9), 5);
    expect(rows(html)).toBe(5);
    expect(html).toContain("Show 4 more");
  });
});
