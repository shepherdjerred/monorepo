import { describe, expect, test } from "vitest";
import {
  platformToAccountRegionalRoute,
  platformToRegionalRoute,
  regionToPlatformRoute,
} from "#src/model/core/routes.ts";
import { type Region, RegionSchema } from "#src/model/riot/league-account.ts";

describe("regionToPlatformRoute", () => {
  const expected: Record<Region, string> = {
    BRAZIL: "BR1",
    EU_EAST: "EUN1",
    EU_WEST: "EUW1",
    KOREA: "KR",
    LAT_NORTH: "LA1",
    LAT_SOUTH: "LA2",
    AMERICA_NORTH: "NA1",
    OCEANIA: "OC1",
    TURKEY: "TR1",
    RUSSIA: "RU",
    JAPAN: "JP1",
    VIETNAM: "VN2",
    TAIWAN: "TW2",
    SINGAPORE: "SG2",
    PBE: "PBE1",
  };

  test("maps every declared region to its platform route", () => {
    for (const region of RegionSchema.options) {
      expect(regionToPlatformRoute(region)).toBe(expected[region]);
    }
  });
});

describe("platformToRegionalRoute", () => {
  test("maps a representative platform of each MatchV5 routing group", () => {
    expect(platformToRegionalRoute("NA1")).toBe("AMERICAS");
    expect(platformToRegionalRoute("EUW1")).toBe("EUROPE");
    expect(platformToRegionalRoute("KR")).toBe("ASIA");
    expect(platformToRegionalRoute("OC1")).toBe("SEA");
  });

  test("routes ME1 through EUROPE", () => {
    expect(platformToRegionalRoute("ME1")).toBe("EUROPE");
  });

  test("routes PBE1 through AMERICAS", () => {
    expect(platformToRegionalRoute("PBE1")).toBe("AMERICAS");
  });

  test("accepts a domain Region and resolves it first", () => {
    expect(platformToRegionalRoute("KOREA")).toBe("ASIA");
    expect(platformToRegionalRoute("SINGAPORE")).toBe("SEA");
  });
});

describe("platformToAccountRegionalRoute", () => {
  test("SEA platforms route through ASIA for Account-V1", () => {
    expect(platformToAccountRegionalRoute("OC1")).toBe("ASIA");
    expect(platformToAccountRegionalRoute("VN2")).toBe("ASIA");
  });

  test("non-SEA groups pass through unchanged", () => {
    expect(platformToAccountRegionalRoute("NA1")).toBe("AMERICAS");
    expect(platformToAccountRegionalRoute("EUW1")).toBe("EUROPE");
    expect(platformToAccountRegionalRoute("KR")).toBe("ASIA");
  });

  test("accepts a domain Region input", () => {
    expect(platformToAccountRegionalRoute("SINGAPORE")).toBe("ASIA");
  });
});
