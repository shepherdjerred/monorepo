import { LeaguePuuidSchema, type PlatformRoute } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  platformsAbsentFromEnabledAccounts,
  splitClashPollAccounts,
} from "./snapshot.ts";

const PUUID = LeaguePuuidSchema.parse("p".repeat(78));

function account(platform: PlatformRoute) {
  return {
    puuid: PUUID,
    region: "AMERICA_NORTH" as const,
    platform,
  };
}

describe("splitClashPollAccounts", () => {
  test("polls platforms in the window and clears the rest", () => {
    const na = account("NA1");
    const euw = account("EUW1");
    const { poll, clear } = splitClashPollAccounts(
      [na, euw],
      new Map<PlatformRoute, boolean>([
        ["NA1", true],
        ["EUW1", false],
      ]),
    );
    expect(poll).toEqual([na]);
    expect(clear).toEqual([euw]);
  });

  test("clears every account when no platform is in the poll window", () => {
    const na = account("NA1");
    const { poll, clear } = splitClashPollAccounts(
      [na],
      new Map<PlatformRoute, boolean>([["NA1", false]]),
    );
    expect(poll).toEqual([]);
    expect(clear).toEqual([na]);
  });
});

describe("platformsAbsentFromEnabledAccounts", () => {
  test("returns stored platforms that no enabled account still occupies", () => {
    expect(
      platformsAbsentFromEnabledAccounts(["NA1", "EUW1", "KR"], ["NA1"]),
    ).toEqual(["EUW1", "KR"]);
  });
});
