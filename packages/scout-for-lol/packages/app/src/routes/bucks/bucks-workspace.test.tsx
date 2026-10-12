import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  bucksSectionItems,
  resolveBucksGuildSelection,
} from "#src/routes/bucks/bucks-workspace.tsx";

describe("bucksSectionItems", () => {
  test("hides Dares when the selected guild has no Dare access", () => {
    expect(bucksSectionItems(false)).toEqual([
      { label: "Overview", to: "/bucks", end: true },
      { label: "History", to: "/bucks/history", end: false },
      { label: "Leaderboard", to: "/bucks/leaderboard", end: false },
      { label: "Settings", to: "/bucks/settings", end: false },
    ]);
  });

  test("adds Dares for a guild with the feature or an existing Dare", () => {
    expect(bucksSectionItems(true)).toEqual([
      { label: "Overview", to: "/bucks", end: true },
      { label: "Dares", to: "/bucks/dares", end: false },
      { label: "History", to: "/bucks/history", end: false },
      { label: "Leaderboard", to: "/bucks/leaderboard", end: false },
      { label: "Settings", to: "/bucks/settings", end: false },
    ]);
  });
});

describe("resolveBucksGuildSelection", () => {
  test("is settled with no guild when no guilds are available", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: undefined,
        selectedGuildId: null,
      }),
    ).toEqual({ awaitingGuildChoice: false, guildId: undefined });
  });

  test("auto-selects the single available guild without waiting", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: [
          { id: DiscordGuildIdSchema.parse("818542720658922315") },
        ],
        selectedGuildId: null,
      }),
    ).toEqual({
      awaitingGuildChoice: false,
      guildId: DiscordGuildIdSchema.parse("818542720658922315"),
    });
  });

  test("stays unresolved — not settled — while a multi-guild pick is pending", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: [
          { id: DiscordGuildIdSchema.parse("818542720658922315") },
          { id: DiscordGuildIdSchema.parse("818666133331159861") },
        ],
        selectedGuildId: null,
      }),
    ).toEqual({ awaitingGuildChoice: true, guildId: undefined });
  });

  test("settles once a guild is picked from a multi-guild list", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: [
          { id: DiscordGuildIdSchema.parse("818542720658922315") },
          { id: DiscordGuildIdSchema.parse("818666133331159861") },
        ],
        selectedGuildId: "818666133331159861",
      }),
    ).toEqual({
      awaitingGuildChoice: false,
      guildId: DiscordGuildIdSchema.parse("818666133331159861"),
    });
  });
});
