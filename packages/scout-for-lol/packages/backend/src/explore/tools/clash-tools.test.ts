import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { createClashExploreTools } from "./clash-tools.ts";

const GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const passthroughTracker: ToolTracker = async (_name, work) => await work();

describe("createClashExploreTools", () => {
  test("describes schedule and roster as registration, not results", () => {
    const tools = createClashExploreTools({
      guildIds: [GUILD],
      track: passthroughTracker,
    });
    expect(tools.get_clash_schedule.description).toContain("not match history");
    expect(tools.get_clash_roster.description).toContain("not results");
    expect(tools.get_clash_history.description).toContain("lobby-only");
  });
});
