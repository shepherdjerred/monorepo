import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  daresSectionItems,
  resolveDaresGuildSelection,
} from "#src/routes/dares/dares-workspace.tsx";

describe("daresSectionItems", () => {
  test.each([false, true])(
    "offers only Dares and their settings",
    (available) => {
      expect(daresSectionItems(available)).toEqual([
        { label: "Dares", to: "/dares", end: true },
        { label: "Settings", to: "/dares/settings", end: false },
      ]);
    },
  );
});

describe("resolveDaresGuildSelection", () => {
  test("is settled with no guild when no guilds are available", () => {
    expect(
      resolveDaresGuildSelection({
        availableGuilds: undefined,
        selectedGuildId: null,
      }),
    ).toEqual({ awaitingGuildChoice: false, guildId: undefined });
  });

  test("auto-selects the single available guild without waiting", () => {
    expect(
      resolveDaresGuildSelection({
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
      resolveDaresGuildSelection({
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
      resolveDaresGuildSelection({
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
