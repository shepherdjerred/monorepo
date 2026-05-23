import { describe, expect, test } from "bun:test";
import {
  ShowcaseAssetIndexSchema,
  ShowcaseManifestSchema,
  requiredShowcaseVariantIds,
  validateRequiredShowcaseCoverage,
} from "#src/showcase/manifest.ts";

describe("showcase manifest schemas", () => {
  test("parses s3 image and graph entries", () => {
    const manifest = ShowcaseManifestSchema.parse({
      version: 1,
      entries: [
        {
          kind: "s3-image",
          id: "ranked-solo-1-postmatch",
          title: "Ranked Solo Post-Match",
          group: "Ranked Solo",
          state: "postmatch",
          queue: "solo",
          playerCount: 1,
          imageKey: "games/2026/05/22/NA1_1/report.png",
          dataKey: "games/2026/05/22/NA1_1/match.json",
        },
        {
          kind: "competition-graph",
          id: "competition-graph",
          title: "Competition Graph",
          group: "Graphs",
          snapshotKeys: [
            "leaderboards/competition-1/snapshots/2026-05-22.json",
          ],
          chartType: "bar",
          yAxisLabel: "Wins",
        },
        {
          kind: "report-graph",
          id: "report-graph",
          title: "Report Graph",
          group: "Graphs",
          matchKeys: ["games/2026/05/22/NA1_1/match.json"],
          metric: "damage_to_champions",
          yAxisLabel: "Damage",
        },
      ],
    });

    expect(manifest.entries).toHaveLength(3);
  });

  test("rejects s3 image data validation keys without state", () => {
    expect(() =>
      ShowcaseManifestSchema.parse({
        version: 1,
        entries: [
          {
            kind: "s3-image",
            id: "ranked-solo-1-postmatch",
            title: "Ranked Solo Post-Match",
            group: "Ranked Solo",
            imageKey: "games/2026/05/22/NA1_1/report.png",
            dataKey: "games/2026/05/22/NA1_1/match.json",
          },
        ],
      }),
    ).toThrow("s3-image entries with dataKey must include state");
  });

  test("rejects missing required showcase coverage", () => {
    const index = ShowcaseAssetIndexSchema.parse({
      version: 1,
      generatedAt: "2026-05-22T00:00:00.000Z",
      assets: [
        {
          id: "draft-prematch",
          title: "Draft Pre-Match",
          group: "Draft",
          kind: "unsupported",
          status: "unsupported",
          sourceKeys: [],
          reason: "No real data yet.",
        },
      ],
    });

    expect(() => validateRequiredShowcaseCoverage(index)).toThrow(
      "ranked-solo-1-prematch",
    );
  });

  test("accepts complete required coverage", () => {
    const index = ShowcaseAssetIndexSchema.parse({
      version: 1,
      generatedAt: "2026-05-22T00:00:00.000Z",
      assets: requiredShowcaseVariantIds().map((id) => ({
        id,
        title: id,
        group: "Test",
        kind: "unsupported",
        status: "unsupported",
        sourceKeys: [],
        reason: "Documented unsupported variant.",
      })),
    });

    expect(() => validateRequiredShowcaseCoverage(index)).not.toThrow();
  });
});
