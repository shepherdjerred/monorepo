import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignalList } from "./signal-list.tsx";

function signals(
  count: number,
  kind: string,
  overrides: Partial<Signal> = {},
): Signal[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${String(index)}`,
    source: "alerts",
    section: "alerts",
    kind,
    severity: "warning",
    needsMe: true,
    title: `${kind} ${String(index)}`,
    attributes: {},
    links: [
      {
        kind: "native",
        label: "Open",
        url: `https://example.com/${kind}/${String(index)}`,
      },
    ],
    ...overrides,
  }));
}

function render(
  list: readonly Signal[],
  props: { cap?: number; newIds?: ReadonlySet<string> } = {},
): string {
  return renderToStaticMarkup(
    createElement(SignalList, { signals: list, empty: "Nothing.", ...props }),
  );
}

function rows(html: string): number {
  return html.split('<li class="signal"').length - 1;
}

describe("SignalList", () => {
  it("says so when there is nothing to list", () => {
    expect(render([])).toBe('<p class="list-empty">Nothing.</p>');
  });

  it("shows a small overflow outright instead of hiding two rows", () => {
    const html = render(signals(12, "alert"));
    expect(rows(html)).toBe(12);
    expect(html).not.toContain("list-toggle");
  });

  it("caps a longer list behind a real, labelled button", () => {
    const html = render(signals(13, "alert"));
    expect(rows(html)).toBe(10);
    const listId = /<ul class="signal-list" id="([^"]+)"/u.exec(html)?.[1];
    expect(listId).toBeDefined();
    expect(html).toContain(
      `<button type="button" class="list-toggle" aria-expanded="false" aria-controls="${listId ?? ""}">Show 3 more`,
    );
  });

  it("honours a caller's cap", () => {
    const html = render(signals(8, "alert"), { cap: 5 });
    expect(rows(html)).toBe(5);
    expect(html).toContain("Show 3 more");
  });

  it("collapses an allowlisted kind into one closed disclosure row", () => {
    const restores = signals(10, "restore-failure", {
      source: "maintenance",
      section: "maintenance",
      since: "2026-08-01T00:00:00.000Z",
    });
    const html = render([...signals(2, "alert"), ...restores], {
      newIds: new Set(["restore-failure-0", "restore-failure-3", "alert-0"]),
    });
    // Two alerts and the group: three entries, so no cap toggle.
    expect(html).not.toContain("list-toggle");
    expect(rows(html)).toBe(2);
    expect(html.split('<li class="signal-group"')).toHaveLength(2);

    const summary = /<summary>(.*?)<\/summary>/u.exec(html)?.[1] ?? "";
    expect(summary).toContain("10 failed Velero restores");
    // Severity is an icon plus a word, never colour alone.
    expect(summary).toContain("Warning");
    expect(summary).toContain('<span class="new-tag">2 new</span>');
    expect(summary).toMatch(/oldest \d+d ago/u);
    // The summary is the control; a link inside it would steal the click.
    expect(summary).not.toContain("<a ");
    // Members mount only once the disclosure is opened.
    expect(html).not.toContain("restore-failure 0");
    expect(html).not.toContain("<details open");
  });

  it("counts a group as one entry against the cap", () => {
    const html = render([
      ...signals(100, "renovate-approval", {
        source: "renovate",
        section: "delivery",
        severity: "info",
      }),
      ...signals(11, "alert"),
    ]);
    // One group and eleven alerts are twelve entries: all shown.
    expect(rows(html)).toBe(11);
    expect(html).toContain("100 Renovate updates awaiting approval");
    expect(html).not.toContain("list-toggle");
  });

  it("never collapses alerts", () => {
    const html = render(signals(30, "alert"), { cap: 30 });
    expect(rows(html)).toBe(30);
    expect(html).not.toContain("signal-group");
  });
});
