import { describe, expect, test } from "bun:test";
import {
  CLASSIC_CHAMPION_COUNT,
  CLASSIC_SUMMONER_SPELL_COUNT,
  getModernChampionIdForClassic,
  getModernSpellIdForClassic,
  getSummonerSpellImageNameById,
  resolveClassicChampionKey,
} from "./classic.ts";
import {
  getClassicBackgroundBase64,
  validateChampionImage,
  validateItemImage,
  validateSpellImage,
} from "./images.ts";

describe("League Classic Data Dragon assets", () => {
  test("contains the complete Jade champion and spell catalogs", () => {
    expect(CLASSIC_CHAMPION_COUNT).toBe(60);
    expect(CLASSIC_SUMMONER_SPELL_COUNT).toBe(16);
  });

  test("resolves Classic champion art while mapping inference to modern IDs", async () => {
    expect(resolveClassicChampionKey(60_103)).toBe("Jade_Ahri");
    expect(getModernChampionIdForClassic(60_103)).toBe(103);
    await expect(validateChampionImage("Jade_Ahri")).resolves.toBeUndefined();
  });

  test("resolves exact Jade spell art and modern inference spell IDs", async () => {
    expect(getSummonerSpellImageNameById(74)).toBe("SummonerFlash_Jade.png");
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
