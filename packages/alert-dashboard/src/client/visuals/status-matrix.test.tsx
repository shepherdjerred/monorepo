import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusMatrix } from "./status-matrix.tsx";

describe("StatusMatrix", () => {
  it("renders a keyboard-scrollable named region with glyphs and status badges in every cell", () => {
    const html = renderToStaticMarkup(
      <StatusMatrix
        caption="Backup verification matrix"
        rowHeaderLabel="Dataset"
        columns={[
          { key: "snapshot", label: "Snapshot" },
          { key: "offsite", label: "Offsite" },
          { key: "restore", label: "Restore drill" },
          { key: "audit", label: "Audit" },
          { key: "note", label: "Notes" },
        ]}
        rows={[
          {
            key: "postgres",
            label: "PostgreSQL",
            meta: "daily 02:00 UTC",
            cells: {
              snapshot: { status: "ok", label: "2h ago" },
              offsite: {
                status: "warning",
                label: "29h ago",
                detail: "SLA 24h",
              },
              restore: { status: "error", label: "Failed" },
              note: { status: "info", label: "Pinned" },
            },
          },
        ]}
      />,
    );

    const captionId = /<caption id="([^"]+)"/u.exec(html)?.[1];
    expect(captionId).toBeDefined();
    expect(html).toContain(
      `<div class="visual-matrix-region" role="region" aria-labelledby="${captionId ?? ""}" tabindex="0">`,
    );
    expect(html).toContain('<th scope="row" class="visual-matrix-rowhead"');
    expect(html).toContain("PostgreSQL");
    expect(html).toContain("daily 02:00 UTC");

    // Every status carries both its non-color glyph and semantic badge class.
    expect(html).toContain("visual-matrix-ok");
    expect(html).toContain(">✓<");
    expect(html).toContain("visual-matrix-warning");
    expect(html).toContain(">!<");
    expect(html).toContain('<span class="sr-only">Warning: </span>');
    expect(html).toContain('<span class="sr-only"> (SLA 24h)</span>');
    expect(html).toContain("visual-matrix-error");
    expect(html).toContain(">✕<");
    // Unpopulated column key falls back to `missing` (`—` + `Missing`).
    expect(html).toContain("visual-matrix-missing");
    expect(html).toContain(">—<");
    expect(html).toContain(">Missing<");
    expect(html).toContain("visual-matrix-info");
    expect(html).toContain(">•<");
  });

  it("renders an empty message when no rows are supplied", () => {
    const html = renderToStaticMarkup(
      <StatusMatrix
        caption="Empty matrix"
        hideCaption
        columns={[{ key: "health", label: "Health" }]}
        rows={[]}
        emptyMessage="No targets configured."
      />,
    );
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("No targets configured.");
  });
});
