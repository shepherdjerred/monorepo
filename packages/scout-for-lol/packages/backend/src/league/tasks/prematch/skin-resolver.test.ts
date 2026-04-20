import { describe, expect, test } from "bun:test";
import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";
import { resolveSkinNum } from "#src/league/tasks/prematch/skin-resolver.ts";

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
  test("returns 0 for default skin (always a base skin)", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 0 });
    expect(await resolveSkinNum(participant, "Aatrox")).toBe(0);
  });

  test("returns base skin number unchanged (Aatrox skin 7 is base)", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 7 });
    expect(await resolveSkinNum(participant, "Aatrox")).toBe(7);
  });

  test("resolves chroma to parent skin (Zyra skin 72 is chroma of 64)", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 72 });
    expect(await resolveSkinNum(participant, "Zyra")).toBe(64);
  });
});
