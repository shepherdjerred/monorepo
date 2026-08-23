import { describe, test, expect } from "vitest";
import { getChampionInfo } from "./champion.ts";

describe("getChampionInfo", () => {
  test("loads abilities for a standard champion", async () => {
    const info = await getChampionInfo("Aatrox");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
    expect(info?.passive.name.length).toBeGreaterThan(0);
  });

  test.each(["Aatrox", "LeeSin", "MonkeyKing", "Renata", "Velkoz"])(
    "loads abilities for champion %s",
    async (championName) => {
      const info = await getChampionInfo(championName);
      expect(info).toBeDefined();
      expect(info?.spells).toHaveLength(4);
    },
  );

  test("returns undefined for unknown champion", async () => {
    const info = await getChampionInfo("NonExistentChampion");
    expect(info).toBeUndefined();
  });
});
