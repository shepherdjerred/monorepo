import { describe, expect, test } from "bun:test";
import {
  ExploreMessageSchema,
  VisualizationSnapshotSchema,
} from "@scout-for-lol/data";
import {
  scoutTestBarChart,
  scoutTestKpi,
  scoutTestLeaderboard,
  scoutTestVisualization,
} from "#src/discord/scout/test-fixtures.ts";
import {
  exploreVisualizationPayload,
  usesNativeDiscordVisualization,
  visualizationToEmbed,
} from "#src/discord/scout/visualization.ts";

const answer = ExploreMessageSchema.parse({
  id: "10000000-0000-4000-8000-000000000002",
  role: "assistant",
  parentId: "10000000-0000-4000-8000-000000000001",
  siblingIds: ["10000000-0000-4000-8000-000000000002"],
  content: "Aurora leads.",
  caveats: [],
  createdAt: "2026-08-18T00:00:00.000Z",
});

describe("Scout Discord visualizations", () => {
  test("renders tables, leaderboards, and KPI cards as embeds", () => {
    expect(usesNativeDiscordVisualization(scoutTestVisualization)).toBe(true);
    const table = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestVisualization,
    });
    const tableJson = JSON.stringify(table.embeds);
    expect(table.files).toBeUndefined();
    expect(tableJson).toContain("Win rates");
    expect(tableJson).toContain("Games");
    expect(tableJson).not.toContain("| Games |");
    expect(tableJson).toContain("Aurora");
    expect(tableJson).toContain("100.0%");

    const board = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestLeaderboard,
    });
    expect(JSON.stringify(board.embeds)).toContain("**1.** Aurora");

    const list = exploreVisualizationPayload({
      ...answer,
      visualization: VisualizationSnapshotSchema.parse({
        ...scoutTestVisualization,
        kind: "LIST",
      }),
    });
    const listJson = JSON.stringify(list.embeds);
    expect(listJson).toContain("- Aurora: Games: 8, Win rate: 100.0%");
    expect(listJson).not.toContain("| Games |");

    const leaderboardJson = JSON.stringify(board.embeds);
    expect(leaderboardJson).toContain("Games: 8 · Win rate: 100.0%");

    const kpi = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestKpi,
    });
    const kpiDescription = kpi.embeds?.[0]?.data.description;
    expect(kpiDescription).toContain("56");
    expect(kpiDescription).toContain("Games counted");
    expect(kpiDescription).not.toContain("42");
  });

  test("keeps every native description within Discord's limit", () => {
    const longSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      series: scoutTestVisualization.series.map((series) => ({
        ...series,
        label: "Series label ".repeat(200),
        points: series.points.map((point) => ({
          ...point,
          label: "Point label ".repeat(200),
        })),
      })),
    });

    for (const kind of ["TABLE", "LIST", "LEADERBOARD", "KPI_CARD"] as const) {
      const embed = visualizationToEmbed(
        VisualizationSnapshotSchema.parse({
          ...longSnapshot,
          kind,
          title: "A title that is too long ".repeat(20),
        }),
      );
      const description = embed?.data.description;
      expect(description).toBeString();
      expect(description?.length).toBeLessThanOrEqual(3900);
      expect(embed?.data.title?.length).toBeLessThanOrEqual(256);
    }
  });

  test("still attaches a PNG for chart kinds", () => {
    expect(usesNativeDiscordVisualization(scoutTestBarChart)).toBe(false);
    const payload = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestBarChart,
    });
    expect(payload.embeds).toBeUndefined();
    expect(payload.files?.[0]?.name).toBe("scout-explore.png");
    expect(payload.files?.[0]?.attachment).toBeInstanceOf(Buffer);
  });
});
