import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolSpendPanel, toolSpend } from "./ai-tool-spend.tsx";

function tool(source: string, attributes: Signal["attributes"]): Signal {
  return {
    id: `ai:tool-cost:${source}`,
    source: "ai",
    section: "ai",
    kind: "tool-usage",
    severity: "ok",
    needsMe: false,
    title: `${source} title`,
    attributes,
    links: [],
  };
}

function usage(source: string, monthToDateUsd: number): Signal {
  return tool(source, { source, monthToDateUsd });
}

const TOOLS: readonly Signal[] = [
  usage("kimi", 3.94),
  usage("claude-code", 412.37),
  usage("cursor", 21.18),
  usage("codex", 188.02),
];

describe("toolSpend", () => {
  it("ranks tools by spend, highest first, and totals them", () => {
    const spend = toolSpend(TOOLS);
    expect(spend.rows.map((row) => [row.label, row.monthToDateUsd])).toEqual([
      ["Claude Code", 412.37],
      ["Codex", 188.02],
      ["Cursor", 21.18],
      ["Kimi", 3.94],
    ]);
    expect(spend.totalUsd).toBeCloseTo(625.51, 6);
    expect(spend.invalid).toEqual([]);
  });

  it("orders equal spend by name so the order is stable", () => {
    expect(
      toolSpend([
        usage("zed", 5),
        usage("aider", 5),
        usage("codex", 9),
      ]).rows.map((row) => row.source),
    ).toEqual(["codex", "aider", "zed"]);
  });

  it("is empty with a zero total when no tool reported", () => {
    expect(toolSpend([])).toEqual({ rows: [], totalUsd: 0, invalid: [] });
  });

  it("keeps a signal with incomplete attributes out of the total", () => {
    const missing = tool("codex", { source: "codex" });
    const text = tool("cursor", { source: "cursor", monthToDateUsd: "21.18" });
    const spend = toolSpend([usage("kimi", 4), missing, text]);
    expect(spend.rows.map((row) => row.source)).toEqual(["kimi"]);
    expect(spend.totalUsd).toBe(4);
    expect(spend.invalid).toEqual([missing, text]);
  });
});

describe("ToolSpendPanel", () => {
  it("is a table of tool and API-equivalent spend with a total row", () => {
    const html = renderToStaticMarkup(<ToolSpendPanel signals={TOOLS} />);
    expect(html).toContain('<h2 id="tool-spend-heading">Usage by tool</h2>');
    expect(html).toContain(
      '<table class="tool-table ui-table" aria-labelledby="tool-spend-heading" aria-describedby="tool-spend-note">',
    );
    expect(html).toContain(
      '<th scope="col">Tool</th><th scope="col" class="num">API-equivalent this month</th>',
    );
    expect(
      [
        ...html.matchAll(
          /<th scope="row"[^>]*>([^<]+)<\/th><td class="num">([^<]+)<\/td>/gu,
        ),
      ].map((match) => [match[1], match[2]]),
    ).toEqual([
      ["Claude Code", "$412.37"],
      ["Codex", "$188.02"],
      ["Cursor", "$21.18"],
      ["Kimi", "$3.94"],
      ["Total", "$625.51"],
    ]);
    expect(html).toContain(
      '<tfoot><tr><th scope="row">Total</th><td class="num">$625.51</td></tr></tfoot>',
    );
    // The raw source stays available on the humanized name.
    expect(html).toContain(
      '<th scope="row" title="claude-code">Claude Code</th>',
    );
  });

  it("explains what API-equivalent means", () => {
    const html = renderToStaticMarkup(<ToolSpendPanel signals={TOOLS} />);
    expect(html).toContain(
      '<p class="panel-summary tool-note" id="tool-spend-note">',
    );
    expect(html).toContain("would have cost at API prices");
    expect(html).toContain("not money spent");
  });

  it("renders a signal with incomplete attributes as an alert naming it", () => {
    const html = renderToStaticMarkup(
      <ToolSpendPanel
        signals={[usage("kimi", 4), tool("codex", { source: "codex" })]}
      />,
    );
    expect(html).toContain(
      '<tr class="invalid-row"><td colSpan="2"><p role="alert"><code>ai:tool-cost:codex</code>',
    );
    expect(html).toContain('<td class="num">$4.00</td>');
  });

  it("says so when no tool reported usage", () => {
    const html = renderToStaticMarkup(<ToolSpendPanel signals={[]} />);
    expect(html).toContain("No tool usage reported.");
    expect(html).not.toContain("<table");
  });
});
