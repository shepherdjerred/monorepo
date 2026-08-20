import { describe, expect, test } from "bun:test";
import { ExploreMessageSchema } from "@scout-for-lol/data";
import {
  scoutTestBarChart,
  scoutTestKpi,
  scoutTestLeaderboard,
  scoutTestVisualization,
} from "#src/discord/scout/test-fixtures.ts";
import {
  exploreVisualizationPayload,
  usesNativeDiscordVisualization,
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
    expect(tableJson).toContain("| Games |");
    expect(tableJson).toContain("Aurora");
    expect(tableJson).toContain("100.0%");

    const board = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestLeaderboard,
    });
    expect(JSON.stringify(board.embeds)).toContain("**1.** Aurora");

    const kpi = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestKpi,
    });
    expect(JSON.stringify(kpi.embeds)).toContain("56");
    expect(JSON.stringify(kpi.embeds)).toContain("Games counted");
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
