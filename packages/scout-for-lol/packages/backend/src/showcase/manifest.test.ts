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
          kind: "discord-screenshot",
          id: "arena-discord",
          title: "Arena Discord Screenshot",
          group: "Arena",
          state: "postmatch",
          queue: "arena",
          playerCount: 3,
          imageKey: "games/2026/05/22/NA1_2/report.png",
          dataKey: "games/2026/05/22/NA1_2/match.json",
          timestamp: "5:23 AM",
          appName: "Scout for LoL",
          appNameColor: "#ff5a1f",
          botMessage: "dropped an Arena recap",
          botAvatarText: "S",
          botAvatarColor: "#1f2937",
          embedImageWidth: 940,
          chatMessagesBeforeEmbed: [
            {
              timestamp: "5:22 AM",
              author: "rangedtop",
              avatarText: "R",
              avatarColor: "#23a559",
              content: "drop the arena recap",
            },
          ],
          chatMessagesAfterEmbed: [
            {
              timestamp: "5:24 AM",
              author: "SoaringRed",
              authorColor: "#f0b232",
              content: "that Nocturne build was illegal",
            },
          ],
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

    expect(manifest.entries).toHaveLength(4);
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

  test("rejects discord screenshot data validation keys without state", () => {
    expect(() =>
      ShowcaseManifestSchema.parse({
        version: 1,
        entries: [
          {
            kind: "discord-screenshot",
            id: "arena-discord",
            title: "Arena Discord Screenshot",
            group: "Arena",
            imageKey: "games/2026/05/22/NA1_1/report.png",
            dataKey: "games/2026/05/22/NA1_1/match.json",
          },
        ],
      }),
    ).toThrow("discord-screenshot entries with dataKey must include state");
  });

  test("rejects duplicate manifest entry ids", () => {
    expect(() =>
      ShowcaseManifestSchema.parse({
        version: 1,
        entries: [
          {
            kind: "unsupported",
            id: "draft-prematch",
            title: "Draft Pre-Match",
            group: "Draft",
            reason: "No real data yet.",
          },
          {
            kind: "unsupported",
            id: "draft-prematch",
            title: "Draft Pre-Match Duplicate",
            group: "Draft",
            reason: "No real data yet.",
          },
        ],
      }),
    ).toThrow("Duplicate showcase entry id: draft-prematch");
  });

  test("rejects duplicate asset ids", () => {
    expect(() =>
      ShowcaseAssetIndexSchema.parse({
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
          {
            id: "draft-prematch",
            title: "Draft Pre-Match Duplicate",
            group: "Draft",
            kind: "unsupported",
            status: "unsupported",
            sourceKeys: [],
            reason: "No real data yet.",
          },
        ],
      }),
    ).toThrow("Duplicate showcase asset id: draft-prematch");
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
