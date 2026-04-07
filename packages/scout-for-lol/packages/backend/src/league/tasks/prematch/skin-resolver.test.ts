import { describe, expect, test } from "bun:test";
import { resolveSkinNum } from "#src/league/tasks/prematch/skin-resolver.ts";
import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";

function makeParticipant(
  overrides: Partial<RawCurrentGameParticipant> = {},
): RawCurrentGameParticipant {
  return {
    championId: 266,
    puuid: "test-puuid",
    teamId: 100,
    riotId: "TestPlayer#NA1",
    spell1Id: 4,
    spell2Id: 14,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
    ...overrides,
  };
}

describe("resolveSkinNum", () => {
  test("returns 0 for default skin", () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 0 });
    expect(resolveSkinNum(participant)).toBe(0);
  });

  test("returns the selected skin index", () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 7 });
    expect(resolveSkinNum(participant)).toBe(7);
  });

  test("returns high skin numbers", () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 72 });
    expect(resolveSkinNum(participant)).toBe(72);
  });
});
