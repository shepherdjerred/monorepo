import { describe, test, expect } from "bun:test";
import { championNameOverrides } from "./champion-name-overrides.generated.ts";
import { getChampionInfo } from "./champion.ts";

describe("getChampionInfo", () => {
  test("loads abilities for a standard champion", async () => {
    const info = await getChampionInfo("Aatrox");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
    expect(info?.passive.name.length).toBeGreaterThan(0);
  });

  // Auto-generated override inputs — each must resolve via the normalization
  // layer to a real on-disk champion data file.
  test.each(Object.entries(championNameOverrides))(
    "loads abilities for override input %s (resolves to %s)",
    async (input) => {
      const info = await getChampionInfo(input);
      expect(info).toBeDefined();
      expect(info?.spells).toHaveLength(4);
    },
  );

  test("returns undefined for unknown champion", async () => {
    const info = await getChampionInfo("NonExistentChampion");
    expect(info).toBeUndefined();
  });
});
