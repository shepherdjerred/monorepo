import { describe, test, expect } from "bun:test";
import { getChampionInfo } from "./champion.ts";

describe("getChampionInfo", () => {
  test("loads abilities for a standard champion", async () => {
    const info = await getChampionInfo("Aatrox");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
    expect(info?.passive.name.length).toBeGreaterThan(0);
  });

  test("loads abilities for Rek'Sai via override (Reksai → RekSai)", async () => {
    const info = await getChampionInfo("Reksai");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
  });

  test("loads abilities for JarvanIV via override (Jarvaniv → JarvanIV)", async () => {
    const info = await getChampionInfo("Jarvaniv");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
  });

  test("loads abilities for Fiddlesticks via override (FiddleSticks → Fiddlesticks)", async () => {
    const info = await getChampionInfo("FiddleSticks");
    expect(info).toBeDefined();
    expect(info?.spells).toHaveLength(4);
  });

  test("returns undefined for unknown champion", async () => {
    const info = await getChampionInfo("NonExistentChampion");
    expect(info).toBeUndefined();
  });
});
