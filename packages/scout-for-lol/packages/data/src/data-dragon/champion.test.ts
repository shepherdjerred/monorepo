import { describe, test, expect } from "vitest";
import { getChampionInfo, getChampionTags } from "./champion.ts";

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

  test("exposes per-spell cooldown, cost, and range data", async () => {
    const info = await getChampionInfo("Chogath");
    expect(info).toBeDefined();
    const feast = info?.spells[3];
    expect(feast?.id).toBe("Feast");
    expect(feast?.maxrank).toBe(3);
    expect(feast?.cooldown).toEqual([80, 70, 60]);
    expect(feast?.cooldownBurn).toBe("80/70/60");
    expect(feast?.cost).toEqual([100, 100, 100]);
    expect(feast?.costBurn).toBe("100");
    expect(feast?.costType.length).toBeGreaterThan(0);
    expect(feast?.range).toEqual([175, 175, 175]);
    expect(feast?.rangeBurn).toBe("175");
  });

  test("reads Riot's coarse classes from the bundled champion assets", async () => {
    await expect(getChampionTags("Soraka")).resolves.toContain("Support");
    await expect(getChampionTags("Pyke")).resolves.toEqual(
      expect.arrayContaining(["Support", "Assassin"]),
    );
  });
});
