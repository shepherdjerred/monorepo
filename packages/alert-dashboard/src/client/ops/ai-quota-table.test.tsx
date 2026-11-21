import { Temporal } from "@js-temporal/polyfill";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QuotaPanel, QuotaTable } from "./ai-quota-table.tsx";
import { quotaTable } from "./ai-quota.ts";

const GENERATED_AT = "2026-11-20T12:00:00Z";
const NOW = Temporal.Instant.from("2026-11-20T12:02:00Z");

function quota(
  id: string,
  severity: Signal["severity"],
  attributes: Signal["attributes"],
): Signal {
  return {
    id,
    source: "ai",
    section: "ai",
    kind: "quota-window",
    severity,
    needsMe: false,
    title: `${id} title`,
    attributes,
    links: [],
  };
}

function render(signals: readonly Signal[]): string {
  return renderToStaticMarkup(
    <QuotaTable
      model={quotaTable(signals, GENERATED_AT)}
      now={NOW}
      labelledBy="quota-heading"
    />,
  );
}

/** The markup of the one body row whose text includes `text`. */
function rowWith(html: string, text: string): string {
  const row = html
    .split("<tr")
    .find((part) => part.includes(text) && !part.includes("<thead"));
  if (row === undefined) throw new Error(`No row contains ${text}`);
  return row;
}

const WINDOWS: readonly Signal[] = [
  quota("ai:quota:claude-code:five-hour", "info", {
    provider: "claude-code",
    windowId: "five-hour",
    windowKind: "rolling",
    usedRatio: 1,
    resetsAt: "2026-11-20T11:57:00Z",
  }),
  quota("ai:quota:claude-code:weekly-opus", "error", {
    provider: "claude-code",
    windowId: "weekly-opus",
    windowKind: "modelScoped",
    usedRatio: 0.97,
    resetsAt: "2026-11-22T16:00:00Z",
  }),
  quota("ai:quota:antigravity:antigravity-claude-5h", "info", {
    provider: "antigravity",
    windowId: "antigravity-claude-5h",
    windowKind: "modelScoped",
    usedRatio: 0.91,
    resetsAt: "2026-11-20T13:12:00Z",
  }),
  quota("ai:quota:codex:codex-primary-window", "ok", {
    provider: "codex",
    windowId: "codex-primary-window",
    windowKind: "rolling",
    usedRatio: 0.22,
  }),
];

describe("QuotaTable", () => {
  it("is one table with a row group and a group header per provider", () => {
    const html = render(WINDOWS);
    expect(html).toContain(
      '<table class="quota-table" role="table" aria-labelledby="quota-heading">',
    );
    expect(html.match(/<tbody/gu)).toHaveLength(3);
    expect(
      [...html.matchAll(/<th scope="rowgroup"[^>]*>([^<]+)<\/th>/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(["Antigravity", "Claude Code", "Codex"]);
    // Claude Code's header spans its two windows.
    expect(html).toMatch(
      /<th scope="rowgroup" role="rowheader" rowSpan="2" class="quota-provider" title="claude-code">/u,
    );
    expect(
      [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(["Provider", "Window", "Used", "Resets"]);
  });

  it("gives every window a named meter and keeps its raw id", () => {
    const row = rowWith(render(WINDOWS), "Primary window");
    expect(row).toContain('title="codex-primary-window · rolling"');
    expect(row).toContain(
      'class="meter meter-ok" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="22" aria-label="Codex Primary window quota used"',
    );
    expect(row).toContain('<span style="width:22%"></span>');
    expect(row).toContain('<span class="quota-value">22%</span>');
    expect(row).toContain("reset time unknown");
    // An ok row carries no severity cue.
    expect(row).toContain('<span class="quota-flag"></span>');
  });

  it("colours a row by its signal's severity and names that severity", () => {
    const html = render(WINDOWS);
    const error = rowWith(html, "Weekly · Opus");
    expect(error).toContain('class="quota-row quota-error"');
    expect(error).toContain('class="meter meter-error"');
    expect(error).toMatch(/<svg[^>]*class="[^"]*quota-flag-icon"/u);
    expect(error).toContain('<span class="sr-only">error</span>');
    expect(error).toContain("resets in 2d");

    // 91% is past the error threshold, but the collector capped the window
    // at info because it resets soon; the page does not second-guess that.
    const capped = rowWith(html, "Claude · 5h");
    expect(capped).toContain('class="quota-row quota-info"');
    expect(capped).toContain('class="meter meter-info"');
    expect(capped).toContain('<span class="sr-only">info</span>');
    expect(capped).toContain('<span class="quota-value">91%</span>');
    expect(capped).toMatch(
      /<time dateTime="2026-11-20T13:12:00Z" title="[^"]+">resets in 1h<\/time>/u,
    );
  });

  it("shows a window that has reset as its last reading, not a full bar", () => {
    const row = rowWith(render(WINDOWS), "5-hour");
    expect(row).toContain('class="quota-row quota-info quota-reset"');
    expect(row).toContain('class="meter meter-info meter-reset"');
    expect(row).toContain('aria-valuenow="100"');
    expect(row).toContain('aria-valuetext="reset · was 100%"');
    expect(row).toContain('<span class="quota-value">reset · was 100%</span>');
    expect(row).toContain(
      '<td class="quota-resets" role="cell">awaiting new reading</td>',
    );
  });

  it("keeps the collector's severity on a reset window it still calls an error", () => {
    const row = rowWith(
      render([
        quota("ai:quota:claude-code:five-hour", "error", {
          provider: "claude-code",
          windowId: "five-hour",
          windowKind: "rolling",
          usedRatio: 1,
          resetsAt: "2026-11-20T11:57:00Z",
        }),
      ]),
      "5-hour",
    );
    expect(row).toContain('class="quota-row quota-error quota-reset"');
    expect(row).toContain('<span class="sr-only">error</span>');
    expect(row).toContain("reset · was 100%");
  });

  it("caps the meter at full when usage is over the quota", () => {
    const row = rowWith(
      render([
        quota("ai:quota:cursor:monthly", "error", {
          provider: "cursor",
          windowId: "monthly",
          windowKind: "monthly",
          usedRatio: 1.31,
        }),
      ]),
      "Monthly",
    );
    expect(row).toContain('aria-valuenow="100"');
    expect(row).toContain('<span style="width:100%"></span>');
    expect(row).toContain('<span class="quota-value">131%</span>');
  });

  it("shows the raw id under windows that share a label", () => {
    const html = render([
      quota("ai:quota:codex:window", "ok", {
        provider: "codex",
        windowId: "window",
        windowKind: "rolling",
        usedRatio: 0.1,
      }),
      quota("ai:quota:codex:codex-window", "ok", {
        provider: "codex",
        windowId: "codex-window",
        windowKind: "rolling",
        usedRatio: 0.2,
      }),
    ]);
    expect(html).toContain(
      '<span class="quota-label">Rolling window</span><code>codex-window</code>',
    );
    expect(html).toContain(
      '<span class="quota-label">Rolling window</span><code>window</code>',
    );
    expect(rowWith(render(WINDOWS), "Primary window")).not.toContain("<code>");
  });

  it("renders a signal with incomplete attributes as an alert naming it", () => {
    const html = render([
      ...WINDOWS,
      quota("ai:quota:codex:broken", "warning", {
        provider: "codex",
        usedRatio: 0.4,
      }),
    ]);
    const row = rowWith(html, "ai:quota:codex:broken");
    expect(row).toContain('class="invalid-row"');
    expect(row).toContain('<td colSpan="4" role="cell"><p role="alert">');
    expect(row).toContain("<code>ai:quota:codex:broken</code>");
    expect(row).toContain("ai:quota:codex:broken title");
    expect(row).toContain("without its provider, window id, window kind");
    // The valid windows are all still there.
    expect(html.match(/role="meter"/gu)).toHaveLength(4);
  });
});

describe("QuotaPanel", () => {
  it("counts the windows in its heading", () => {
    const html = renderToStaticMarkup(
      <QuotaPanel signals={WINDOWS} generatedAt={GENERATED_AT} />,
    );
    expect(html).toContain(
      '<h2 id="quota-heading">Subscription quota <span class="count">4</span></h2>',
    );
    expect(html.match(/role="meter"/gu)).toHaveLength(4);
  });

  it("says so when no window is reported", () => {
    const html = renderToStaticMarkup(
      <QuotaPanel signals={[]} generatedAt={GENERATED_AT} />,
    );
    expect(html).toContain("No quota windows reported.");
    expect(html).not.toContain("<table");
  });
});
