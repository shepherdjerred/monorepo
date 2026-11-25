import { describe, expect, test } from "vitest";
import {
  buildPlayerApiUrl,
  buildPlayersApiUrl,
  buildStaffPlayerApiUrl,
  buildStaffPlayerRawUrl,
  buildStaffQueryApiUrl,
} from "./api.ts";
import {
  buildRouteHref,
  DEFAULT_PLAYERS_QUERY,
  DEFAULT_STAFF_QUERY_FILTERS,
  formatDocumentTitle,
  getRoutePageTitle,
  parseRoute,
  playerProfilePath,
} from "./router.ts";

describe("client router and API URL builders", () => {
  test("parses public, player profile, staff, and fallback routes", () => {
    expect(parseRoute("/")).toEqual({ kind: "overview" });
    expect(parseRoute("/activity")).toEqual({ kind: "activity" });
    expect(parseRoute("/pvp")).toEqual({ kind: "pvp" });
    expect(parseRoute("/gameplay")).toEqual({ kind: "gameplay" });
    expect(parseRoute("/staff/network")).toEqual({ kind: "staff-network" });
    expect(parseRoute("/staff/bounces")).toEqual({ kind: "staff-bounces" });

    expect(parseRoute("/player/StormBuilder")).toEqual({
      kind: "player",
      id: "StormBuilder",
    });
    expect(parseRoute("/player/069a79f4-44e9-4726-a5be-fca90e38aaf5")).toEqual({
      kind: "player",
      id: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    });
    expect(parseRoute("/player/%2EFloodgate_User")).toEqual({
      kind: "player",
      id: ".Floodgate_User",
    });

    expect(parseRoute("/unknown/deep/path")).toEqual({
      kind: "not-found",
      pathname: "/unknown/deep/path",
    });
  });

  test("parses and round-trips players directory query parameters", () => {
    const parsed = parseRoute(
      "/players",
      "?q=Jerred&group=regular&platform=java&sort=crystals&dir=asc&page=3&pageSize=50",
    );
    expect(parsed).toEqual({
      kind: "players",
      query: {
        q: "Jerred",
        group: "regular",
        platform: "java",
        sort: "crystals",
        dir: "asc",
        page: 3,
        pageSize: 50,
      },
    });

    if (parsed.kind === "players") {
      expect(buildRouteHref(parsed)).toBe(
        "/players?q=Jerred&group=regular&platform=java&sort=crystals&dir=asc&page=3&pageSize=50",
      );
      expect(buildPlayersApiUrl(parsed.query)).toBe(
        "/api/v1/players?q=Jerred&group=regular&platform=java&sort=crystals&dir=asc&page=3&pageSize=50",
      );
    }

    expect(
      buildRouteHref({ kind: "players", query: DEFAULT_PLAYERS_QUERY }),
    ).toBe("/players");
  });

  test("parses and builds staff query builder filters", () => {
    const parsed = parseRoute(
      "/staff/query",
      "?registeredAfter=2026-01-01&minPlaytimeHours=10&activityGroups=regular,active&platform=bedrock&town=Altaria&countryCode=us&hasBounce=true",
    );
    expect(parsed).toEqual({
      kind: "staff-query",
      filters: {
        ...DEFAULT_STAFF_QUERY_FILTERS,
        registeredAfter: "2026-01-01",
        minPlaytimeHours: "10",
        activityGroups: ["regular", "active"],
        platform: "bedrock",
        town: "Altaria",
        countryCode: "US",
        hasBounce: true,
      },
    });

    if (parsed.kind === "staff-query") {
      const apiUrl = buildStaffQueryApiUrl(parsed.filters);
      const urlObj = new URL(apiUrl, "http://localhost");
      expect(urlObj.pathname).toBe("/api/staff/query");
      expect(Object.fromEntries(urlObj.searchParams.entries())).toEqual({
        registeredAfter: "2026-01-01",
        minPlaytimeHours: "10",
        town: "Altaria",
        countryCode: "US",
        activityGroups: "regular,active",
        platform: "bedrock",
        hasBounce: "true",
      });
    }

    expect(buildStaffQueryApiUrl(DEFAULT_STAFF_QUERY_FILTERS)).toBe(
      "/api/staff/query",
    );
  });

  test("formats document titles and encodes player endpoint paths", () => {
    expect(
      formatDocumentTitle(getRoutePageTitle({ kind: "player", id: "Jerred" })),
    ).toBe("Jerred · Player Profile · The Storm Analytics");
    expect(playerProfilePath("Name With Spaces")).toBe(
      "/player/Name%20With%20Spaces",
    );
    expect(buildPlayerApiUrl("Jerred")).toBe("/api/v1/players/Jerred");
    expect(buildStaffPlayerApiUrl("Jerred")).toBe("/api/staff/players/Jerred");
    expect(buildStaffPlayerRawUrl("Jerred")).toBe(
      "/api/staff/players/Jerred/raw",
    );
  });
});
