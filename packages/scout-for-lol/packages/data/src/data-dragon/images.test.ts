import { describe, test, expect } from "bun:test";
import {
  getChampionImageUrl,
  getChampionLoadingImageBase64,
  getChampionLoadingImageUrl,
  getItemImageUrl,
  normalizeChampionName,
  validateChampionImage,
  validateChampionLoadingImage,
  validateItemImage,
  validateSpellImage,
  validateRuneIcon,
  validateAugmentIcon,
} from "./images.ts";

// Every entry in `championNameOverrides`. Add a row here whenever the
// override map grows so the normalization contract stays tested.
const championOverrides: readonly (readonly [string, string])[] = [
  ["FiddleSticks", "Fiddlesticks"],
  ["Reksai", "RekSai"],
  ["Kogmaw", "KogMaw"],
  ["Monkeyking", "MonkeyKing"],
  ["Aurelionsol", "AurelionSol"],
  ["Drmundo", "DrMundo"],
  ["Leesin", "LeeSin"],
  ["Masteryi", "MasterYi"],
  ["Missfortune", "MissFortune"],
  ["Tahmkench", "TahmKench"],
  ["Twistedfate", "TwistedFate"],
  ["Xinzhao", "XinZhao"],
  ["Ksante", "KSante"],
  ["JarvanIv", "JarvanIV"],
  ["Jarvaniv", "JarvanIV"],
];

test("throws error when champion image doesn't exist", async () => {
  await expect(validateChampionImage("NonExistentChampion")).rejects.toThrow(
    /Champion image for NonExistentChampion not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when item image doesn't exist", async () => {
  await expect(validateItemImage(99_999)).rejects.toThrow(
    /Item image for item 99999 not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when spell image doesn't exist", async () => {
  await expect(validateSpellImage("NonExistent.png")).rejects.toThrow(
    /Summoner spell image NonExistent.png not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when rune image doesn't exist", async () => {
  await expect(validateRuneIcon("perk-images/NonExistent.png")).rejects.toThrow(
    /Rune image NonExistent.png not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when augment image doesn't exist", async () => {
  await expect(
    validateAugmentIcon("assets/ux/cherry/augments/icons/nonexistent.png"),
  ).rejects.toThrow(
    /Augment image nonexistent.png not found.*Run 'bun run update-data-dragon'/,
  );
});

test("validates existing champion image", async () => {
  // Aatrox should always exist in our cached data
  await expect(validateChampionImage("Aatrox")).resolves.toBeUndefined();
});

test("validates existing item image", async () => {
  // Item 1001 (Boots) should exist
  await expect(validateItemImage(1001)).resolves.toBeUndefined();
});

test("returns CDN URL for champion image", () => {
  const url = getChampionImageUrl("Aatrox");
  expect(url).toStartWith("https://ddragon.leagueoflegends.com/cdn/");
  expect(url).toContain("/img/champion/Aatrox.png");
});

test("returns CDN URL for item image", () => {
  const url = getItemImageUrl(1001);
  expect(url).toStartWith("https://ddragon.leagueoflegends.com/cdn/");
  expect(url).toContain("/img/item/1001.png");
});

describe("championNameOverrides", () => {
  test.each(championOverrides)(
    "normalizeChampionName(%s) === %s",
    (input, expected) => {
      expect(normalizeChampionName(input)).toBe(expected);
    },
  );

  test("non-override input is returned unchanged", () => {
    expect(normalizeChampionName("Aatrox")).toBe("Aatrox");
    expect(normalizeChampionName("Ahri")).toBe("Ahri");
    expect(normalizeChampionName("SomeUnknownChampion")).toBe(
      "SomeUnknownChampion",
    );
  });

  test.each(championOverrides)(
    "validateChampionImage finds on-disk asset for override input %s",
    async (input) => {
      await expect(validateChampionImage(input)).resolves.toBeUndefined();
    },
  );

  test.each(championOverrides)(
    "getChampionImageUrl rewrites %s to the correct CDN path",
    (input, expected) => {
      expect(getChampionImageUrl(input)).toContain(
        `/img/champion/${expected}.png`,
      );
    },
  );

  test.each(championOverrides)(
    "validateChampionLoadingImage finds loading art for override input %s",
    async (input) => {
      await expect(
        validateChampionLoadingImage(input, 0),
      ).resolves.toBeUndefined();
    },
  );

  test.each(championOverrides)(
    "getChampionLoadingImageUrl rewrites %s to the correct CDN path",
    (input, expected) => {
      expect(getChampionLoadingImageUrl(input, 0)).toContain(
        `/img/champion/loading/${expected}_0.jpg`,
      );
    },
  );

  test("getChampionLoadingImageBase64 returns a non-empty data URI for an overridden name", async () => {
    const dataUri = await getChampionLoadingImageBase64("Reksai", 0);
    expect(dataUri).toStartWith("data:image/jpeg;base64,");
    // base64 payload after the comma must be non-trivial
    const payload = dataUri.split(",", 2)[1] ?? "";
    expect(payload.length).toBeGreaterThan(100);
  });
});

describe("validateChampionLoadingImage missing asset", () => {
  test("throws pointing at update-data-dragon", async () => {
    await expect(
      validateChampionLoadingImage("NonExistentChampion", 0),
    ).rejects.toThrow(
      /Champion loading image for NonExistentChampion skin 0 not found.*Run 'bun run update-data-dragon'/,
    );
  });
});
