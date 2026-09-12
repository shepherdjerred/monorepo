import { describe, expect, test } from "vitest";
import {
  consumerNavigationItems,
  GUILD_NAVIGATION_ITEMS,
  guildWorkspacePath,
  resolveHallTo,
  visibleGuildNavigationItems,
} from "#src/lib/routes/app-navigation.ts";

function canReadCustoms(permission: {
  resource: string;
  action: string;
}): boolean {
  return permission.resource === "customs";
}

function canReadReports(permission: {
  resource: string;
  action: string;
}): boolean {
  return permission.resource === "reports";
}

describe("consumer navigation", () => {
  test.each([
    {
      exploreAvailable: true,
      profilesAvailable: true,
      challengesAvailable: true,
      bucksAvailable: true,
      expected: ["Explore", "Players", "Challenges", "Bryan Bucks"],
    },
    {
      exploreAvailable: true,
      profilesAvailable: false,
      challengesAvailable: false,
      bucksAvailable: false,
      expected: ["Explore"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: true,
      challengesAvailable: false,
      bucksAvailable: false,
      expected: ["Players"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      challengesAvailable: true,
      bucksAvailable: true,
      expected: ["Challenges", "Bryan Bucks"],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      challengesAvailable: false,
      bucksAvailable: false,
      hallAvailable: true,
      expected: ["Hall of Fame"],
    },
    {
      exploreAvailable: true,
      profilesAvailable: true,
      challengesAvailable: true,
      bucksAvailable: true,
      hallAvailable: true,
      expected: [
        "Explore",
        "Players",
        "Hall of Fame",
        "Challenges",
        "Bryan Bucks",
      ],
    },
    {
      exploreAvailable: false,
      profilesAvailable: false,
      challengesAvailable: false,
      bucksAvailable: false,
      expected: [],
    },
  ])("shows only enabled member features", (input) => {
    expect(consumerNavigationItems(input).map((item) => item.label)).toEqual(
      input.expected,
    );
  });

  test("links Hall of Fame to custom path or /halls", () => {
    expect(
      consumerNavigationItems({
        exploreAvailable: false,
        profilesAvailable: false,
        challengesAvailable: false,
        bucksAvailable: false,
        hallAvailable: true,
      }),
    ).toEqual([{ label: "Hall of Fame", to: "/halls" }]);

    expect(
      consumerNavigationItems({
        exploreAvailable: false,
        profilesAvailable: false,
        challengesAvailable: false,
        bucksAvailable: false,
        hallAvailable: true,
        hallTo: "/halls/123",
      }),
    ).toEqual([{ label: "Hall of Fame", to: "/halls/123" }]);
  });

  test("resolves Hall of Fame path based on active guild and guild count", () => {
    expect(
      resolveHallTo({ id: "guild-active" }, [{ id: "g1" }, { id: "g2" }]),
    ).toBe("/halls/guild-active");
    expect(resolveHallTo(undefined, [{ id: "solo-guild" }])).toBe(
      "/halls/solo-guild",
    );
    expect(resolveHallTo(undefined, [{ id: "g1" }, { id: "g2" }])).toBe(
      "/halls",
    );
    expect(resolveHallTo(undefined, [])).toBe("/halls");
  });
});

describe("guild navigation", () => {
  test("keeps the permission-filtered server sections in product order", () => {
    expect(GUILD_NAVIGATION_ITEMS.map((item) => item.label)).toEqual([
      "Customs",
      "Subscriptions",
      "Players",
      "Competitions",
      "Reports",
      "Hall settings",
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

  test("shows beta customs only when the guild policy is enabled", () => {
    expect(
      visibleGuildNavigationItems(canReadCustoms).map((item) => item.label),
    ).toEqual([]);
    expect(
      visibleGuildNavigationItems(canReadCustoms, true).map(
        (item) => item.label,
      ),
    ).toEqual(["Customs"]);
  });

  test("shows Hall settings only with the feature and both report permissions", () => {
    expect(
      visibleGuildNavigationItems(canReadReports, false, true).map(
        (item) => item.label,
      ),
    ).toEqual(["Reports", "Hall settings"]);
    expect(
      visibleGuildNavigationItems(
        (permission) =>
          permission.resource === "reports" && permission.action === "read",
        false,
        true,
      ).map((item) => item.label),
    ).toEqual(["Reports"]);
  });

  test("selecting a server targets its permission-aware index route", () => {
    expect(guildWorkspacePath("discord-123")).toBe("/g/discord-123");
  });
});
