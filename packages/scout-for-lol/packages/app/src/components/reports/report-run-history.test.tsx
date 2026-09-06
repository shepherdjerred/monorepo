import { describe, expect, test } from "vitest";
import { ReportIdSchema } from "@scout-for-lol/data";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportRunHistory } from "#src/components/reports/report-run-history.tsx";

describe("ReportRunHistory", () => {
  test("exposes the exact archived ScoutQL for a run", () => {
    const querySnapshot =
      "SELECT games FROM match_participants GROUP BY all RENDER table";
    const markup = renderToStaticMarkup(
      <ReportRunHistory
        guildId="guild"
        reportId={ReportIdSchema.parse(1)}
        runs={[
          {
            id: 1,
            trigger: "MANUAL",
            status: "SUCCEEDED",
            startedAt: "2026-08-08T00:00:00.000Z",
            durationMs: 10,
            rowsReturned: 1,
            rowsScanned: 1,
            errorMessage: null,
            renderedContent: null,
            hasImage: false,
            visualization: null,
            querySnapshot,
          },
        ]}
      />,
    );

    expect(markup).toContain("ScoutQL snapshot");
    expect(markup).toContain(querySnapshot);
  });
});
