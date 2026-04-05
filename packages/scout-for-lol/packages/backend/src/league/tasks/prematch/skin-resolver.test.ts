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
    summonerName: "TestPlayer",
    spell1Id: 4,
    spell2Id: 14,
    bot: false,
    profileIconId: 1,
    summonerId: "test-summoner-id",
    ...overrides,
  };
}

describe("resolveSkinNum", () => {
  test("returns 0 when no gameCustomizationObjects", () => {
    const participant = makeParticipant();
    expect(resolveSkinNum(participant, "Aatrox")).toBe(0);
  });

  test("returns 0 when gameCustomizationObjects is empty", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(0);
  });

  test("extracts skin num from 'skin' category", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [
        { category: "skin", content: "3" },
      ],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(3);
  });

  test("extracts skin num from 'champion-skin' category", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [
        { category: "champion-skin", content: "7" },
      ],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(7);
  });

  test("extracts skin from JSON content with skinId field", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [
        {
          category: "other",
          content: JSON.stringify({ skinId: 5 }),
        },
      ],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(5);
  });

  test("returns 0 for unrecognized categories with non-numeric content", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [
        { category: "perks", content: "some-rune-data" },
      ],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(0);
  });

  test("returns 0 for negative skin numbers", () => {
    const participant = makeParticipant({
      gameCustomizationObjects: [
        { category: "skin", content: "-1" },
      ],
    });
    expect(resolveSkinNum(participant, "Aatrox")).toBe(0);
  });
});
