import { describe, expect, test } from "vitest";
import {
  bucksSectionItems,
  resolveBucksGuildSelection,
} from "#src/routes/bucks-workspace.tsx";

describe("bucksSectionItems", () => {
  test("lists the four sections with an exact-match overview", () => {
    expect(bucksSectionItems()).toEqual([
      { label: "Overview", to: "/bucks", end: true },
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
        availableGuilds: [{ id: "1" }],
        selectedGuildId: null,
      }),
    ).toEqual({ awaitingGuildChoice: false, guildId: "1" });
  });

  test("stays unresolved — not settled — while a multi-guild pick is pending", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: [{ id: "1" }, { id: "2" }],
        selectedGuildId: null,
      }),
    ).toEqual({ awaitingGuildChoice: true, guildId: undefined });
  });

  test("settles once a guild is picked from a multi-guild list", () => {
    expect(
      resolveBucksGuildSelection({
        availableGuilds: [{ id: "1" }, { id: "2" }],
        selectedGuildId: "2",
      }),
    ).toEqual({ awaitingGuildChoice: false, guildId: "2" });
  });
});
