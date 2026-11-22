import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AreasTable } from "./areas-table.tsx";
import { volumeSnapshotResponse } from "#test-fixtures/ops-snapshot-volume";

const NOW = "2026-08-08T12:00:00Z";

function render(snapshot: SnapshotResponse): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AreasTable, { snapshot })),
  );
}

/** The row for one area, from its opening tag to its closing one. */
function areaRow(html: string, sectionTitle: string): string {
  const row = [...html.matchAll(/<tr class="area-row"[\s\S]*?<\/tr>/gu)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`>${sectionTitle}<`));
  if (row === undefined) throw new Error(`no row for ${sectionTitle}`);
  return row;
}

describe("AreasTable", () => {
  const snapshot = volumeSnapshotResponse(NOW, "aggregate");
  const section = snapshot.sections.find(
    (candidate) => candidate.sources.length > 0,
  );
  if (section === undefined) throw new Error("fixture has no sourced area");
  const [source] = section.sources;
  if (source === undefined) throw new Error("fixture area has no source");

  it("notes no failed sources when every source reported ok", () => {
    const html = render({
      ...snapshot,
      sources: section.sources.map((id) => ({
        source: id,
        ok: true,
        observedAt: NOW,
        durationMs: 1,
      })),
    });
    expect(areaRow(html, section.title)).not.toContain("no data from");
  });

  it("treats a source missing from the report as failed", () => {
    const html = render({
      ...snapshot,
      sources: snapshot.sources.filter((status) => status.source !== source),
    });
    expect(areaRow(html, section.title)).toContain(`no data from ${source}`);
  });
});
