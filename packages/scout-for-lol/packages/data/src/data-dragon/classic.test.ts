import { describe, expect, test } from "vitest";
import {
  CLASSIC_CHAMPION_COUNT,
  CLASSIC_SUMMONER_SPELL_COUNT,
  getClassicChampionId,
  getClassicSpellId,
  getModernChampionIdForClassic,
  getModernSpellIdForClassic,
  getSummonerSpellImageNameById,
  resolveClassicChampionKey,
  validateClassicChampionCatalog,
} from "./classic.ts";
import championData from "./assets/champion.json" with { type: "json" };
import {
  getClassicBackgroundBase64,
  validateChampionImage,
  validateChampionLoadingImage,
  validateChampionSplashImage,
  validateItemImage,
  validateSpellImage,
} from "./images.ts";

describe("League Classic Data Dragon assets", () => {
  test("contains the complete Jade champion and spell catalogs", () => {
    expect(CLASSIC_CHAMPION_COUNT).toBeGreaterThan(0);
    expect(CLASSIC_SUMMONER_SPELL_COUNT).toBeGreaterThan(0);
    expect(() => validateClassicChampionCatalog()).not.toThrow();
    for (const entry of Object.values(championData.data)) {
      if (!entry.id.startsWith("Jade_")) {
        continue;
      }
      const modernId = Number(entry.key) - 60_000;
      expect(getClassicChampionId(modernId)).toBe(Number(entry.key));
      expect(getModernChampionIdForClassic(Number(entry.key))).toBe(modernId);
    }
  });

  test("resolves Classic champion art while mapping inference to modern IDs", async () => {
    expect(resolveClassicChampionKey(60_103)).toBe("Jade_Ahri");
    expect(resolveClassicChampionKey(103)).toBe("Jade_Ahri");
    expect(getClassicChampionId(103)).toBe(60_103);
    expect(getClassicChampionId(60_103)).toBe(60_103);
    expect(getModernChampionIdForClassic(60_103)).toBe(103);
    await expect(validateChampionImage("Jade_Ahri")).resolves.toBeUndefined();
  });

  test.each([
    [84, 60_084, "Jade_Akali"],
    [85, 60_085, "Jade_Kennen"],
    [98, 60_098, "Jade_Shen"],
  ] as const)(
    "resolves newly-added Classic champion %s",
    async (modernId, classicId, key) => {
      expect(resolveClassicChampionKey(modernId)).toBe(key);
      expect(getClassicChampionId(modernId)).toBe(classicId);
      expect(getModernChampionIdForClassic(classicId)).toBe(modernId);
      expect(resolveClassicChampionKey(classicId)).toBe(key);
      await expect(validateChampionImage(key)).resolves.toBeUndefined();
      await expect(validateChampionLoadingImage(key)).resolves.toBeUndefined();
      await expect(validateChampionSplashImage(key)).resolves.toBeUndefined();
    },
  );

  test("resolves exact Jade spell art and modern inference spell IDs", async () => {
    expect(getSummonerSpellImageNameById(74)).toBe("SummonerFlash_Jade.png");
    expect(getClassicSpellId(4)).toBe(74);
    expect(getClassicSpellId(74)).toBe(74);
    expect(getClassicSpellId(32)).toBe(32);
    expect(getModernSpellIdForClassic(32)).toBe(32);
    expect(getModernSpellIdForClassic(74)).toBe(4);
    await expect(
      validateSpellImage("SummonerFlash_Jade.png"),
    ).resolves.toBeUndefined();
  });

  test("leaves Classic-only spells without a modern lane prior", () => {
    expect(getModernSpellIdForClassic(705)).toBeUndefined();
  });

  test("includes Jade items and the official loading background", async () => {
    await expect(validateItemImage(771_001)).resolves.toBeUndefined();
    const background = await getClassicBackgroundBase64();
    expect(background.startsWith("data:image/png;base64,")).toBe(true);
  });
});
