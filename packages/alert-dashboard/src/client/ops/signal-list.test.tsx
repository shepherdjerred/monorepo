import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignalList, estimatedListLines } from "./signal-list.tsx";

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
  return html.split('<tr class="signal" ').length - 1;
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
    const listId = /<table class="ui-table signal-list" id="([^"]+)"/u.exec(
      html,
    )?.[1];
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
    expect(html.split('<tr class="signal-group"')).toHaveLength(2);

    // The group's row; its title is the disclosure button.
    const summary =
      /<tr class="signal-group"(.*?)<\/tr>/u.exec(html)?.[1] ?? "";
    expect(summary).toContain("10 failed Velero restores");
    // Severity is an icon plus a word, never colour alone.
    expect(summary).toContain("Warning");
    expect(summary).toContain('<span class="new-count">2 new</span>');
    expect(summary).toMatch(/oldest \d+d ago/u);
    // The summary is the control; a link inside it would steal the click.
    expect(summary).not.toContain("<a ");
    // Members mount only once the disclosure is opened.
    expect(html).not.toContain("restore-failure 0");
    expect(html).not.toContain('aria-expanded="true"');
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

describe("estimatedListLines", () => {
  it("counts an empty list as its one line", () => {
    expect(estimatedListLines([])).toBe(1);
  });

  it("gives a row its padding and title, and more for what else it shows", () => {
    const [plain] = signals(1, "alert");
    if (plain === undefined) throw new Error("no signal");
    // The column head and the one severity heading row come first.
    expect(estimatedListLines([plain])).toBe(2 + 2);
    // A second link adds a line of chips; `since` has its own column.
    expect(
      estimatedListLines([
        {
          ...plain,
          links: [
            ...plain.links,
            { kind: "native", label: "More", url: "https://example.com/more" },
          ],
        },
      ]),
    ).toBe(2 + 3);
    expect(
      estimatedListLines([
        { ...plain, title: "t".repeat(80), detail: "d".repeat(120) },
      ]),
    ).toBe(2 + 1 + 3 + 3);
  });

  it("counts a collapsed group as one short row", () => {
    const restores = signals(10, "restore-failure", {
      source: "maintenance",
      section: "maintenance",
      detail: "d".repeat(120),
    });
    expect(estimatedListLines(restores)).toBe(2 + 2);
  });

  it("stops at the cap and leaves room for the toggle", () => {
    const list = signals(30, "alert");
    expect(estimatedListLines(list)).toBe(2 + 10 * 2 + 2);
    expect(estimatedListLines(list, 5)).toBe(2 + 5 * 2 + 2);
    // Twelve fit within the slack, so all twelve show and there is no toggle.
    expect(estimatedListLines(signals(12, "alert"))).toBe(2 + 12 * 2);
  });
});
