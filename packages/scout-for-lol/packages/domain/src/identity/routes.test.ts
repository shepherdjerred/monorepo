import { describe, expect, test } from "vitest";
import {
  AccountRegionalRouteSchema,
  PlatformRouteSchema,
  RegionalRouteSchema,
} from "#src/identity/routes.ts";

describe("PlatformRouteSchema", () => {
  test("accepts declared platform routes", () => {
    expect(PlatformRouteSchema.safeParse("NA1").success).toBe(true);
    expect(PlatformRouteSchema.safeParse("ME1").success).toBe(true);
    expect(PlatformRouteSchema.safeParse("PBE1").success).toBe(true);
  });

  test("rejects unknown values and wrong casing", () => {
    expect(PlatformRouteSchema.safeParse("XX9").success).toBe(false);
    expect(PlatformRouteSchema.safeParse("na1").success).toBe(false);
    expect(PlatformRouteSchema.safeParse("").success).toBe(false);
  });
});

describe("RegionalRouteSchema", () => {
  test("accepts all four MatchV5 routing groups, including SEA", () => {
    for (const route of ["AMERICAS", "ASIA", "EUROPE", "SEA"]) {
      expect(RegionalRouteSchema.safeParse(route).success).toBe(true);
    }
  });

  test("rejects unknown values", () => {
    expect(RegionalRouteSchema.safeParse("OCEANIA").success).toBe(false);
    expect(RegionalRouteSchema.safeParse("sea").success).toBe(false);
  });
});

describe("AccountRegionalRouteSchema", () => {
  test("accepts the three Account-V1 routing groups", () => {
    for (const route of ["AMERICAS", "ASIA", "EUROPE"]) {
      expect(AccountRegionalRouteSchema.safeParse(route).success).toBe(true);
    }
  });

  test("rejects SEA — Account-V1 routes SEA accounts through ASIA", () => {
    expect(AccountRegionalRouteSchema.safeParse("SEA").success).toBe(false);
  });
});
