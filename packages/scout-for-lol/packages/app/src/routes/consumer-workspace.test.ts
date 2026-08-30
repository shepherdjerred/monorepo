import { describe, expect, test } from "vitest";
import {
  consumerNavigationItems,
  GUILD_NAVIGATION_ITEMS,
  guildWorkspacePath,
  visibleGuildNavigationItems,
} from "#src/lib/app-navigation.ts";

describe("consumer navigation", () => {
  test.each([
    {
      exploreAvailable: true,
      profilesAvailable: true,
      bucksAvailable: true,
      expected: ["Explore", "Players", "Bryan Bucks"],
    },
    {
      exploreAvailable: true,
      profilesAvailable: false,
      bucksAvailable: false,
      expected: ["Explore"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: true,
      bucksAvailable: false,
      expected: ["Players"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      bucksAvailable: true,
      expected: ["Bryan Bucks"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      bucksAvailable: false,
      expected: [],
    },
  ])("shows only enabled member features", (input) => {
    expect(consumerNavigationItems(input).map((item) => item.label)).toEqual(
      input.expected,
    );
  });
});

describe("guild navigation", () => {
  test("keeps the permission-filtered server sections in product order", () => {
    expect(GUILD_NAVIGATION_ITEMS.map((item) => item.label)).toEqual([
      "Subscriptions",
      "Players",
      "Competitions",
      "Reports",
      "Audit",
      "Access",
    ]);
  });

  test("shows only sections the member can read", () => {
    expect(
      visibleGuildNavigationItems(
        (permission) =>
          permission.resource === "reports" || permission.resource === "roles",
      ).map((item) => item.label),
    ).toEqual(["Reports", "Access"]);
  });

  test("selecting a server targets its permission-aware index route", () => {
    expect(guildWorkspacePath("discord-123")).toBe("/g/discord-123");
  });
});
