import { describe, expect, test, mock } from "bun:test";
import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";

// Mock resolveLoadingSkinNum to avoid needing champion-skins.json on disk.
// We provide only the export that skin-resolver.ts uses; Bun's mock.module
// merges this with the real module's other exports.
void mock.module("@scout-for-lol/data/index.ts", () => ({
  resolveLoadingSkinNum: async (_championName: string, skinNum: number) =>
    skinNum,
}));

// Import after mock
const { resolveSkinNum } =
  await import("#src/league/tasks/prematch/skin-resolver.ts");

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
  test("returns 0 for default skin", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 0 });
    expect(await resolveSkinNum(participant, "Aatrox")).toBe(0);
  });

  test("returns the selected skin index", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 7 });
    expect(await resolveSkinNum(participant, "Aatrox")).toBe(7);
  });

  test("returns high skin numbers (chroma range)", async () => {
    const participant = makeParticipant({ lastSelectedSkinIndex: 72 });
    expect(await resolveSkinNum(participant, "Zyra")).toBe(72);
  });
});
