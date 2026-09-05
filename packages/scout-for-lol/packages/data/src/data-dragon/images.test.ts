import { describe, test, expect } from "vitest";
import { normalizeChampionName } from "#src/model/riot/champion-registry.ts";
import {
  championNameToDisplayName,
  getChampionDisplayNameById,
  getChampionImageUrl,
  getChampionLoadingImageBase64,
  getChampionLoadingImageUrl,
  getItemImageUrl,
  validateChampionImage,
  validateChampionLoadingImage,
  validateChampionSplashImage,
  validateItemImage,
  validateSpellImage,
  validateRuneIcon,
  validateAugmentIcon,
} from "./images.ts";

const representativeChampions: readonly (readonly [string, string])[] = [
  ["Aatrox", "Aatrox"],
  ["LeeSin", "LeeSin"],
  ["leesin", "LeeSin"],
  ["MonkeyKing", "MonkeyKing"],
  ["wukong", "MonkeyKing"],
  ["FiddleSticks", "Fiddlesticks"],
  ["fiddlesticks", "Fiddlesticks"],
  ["RekSai", "RekSai"],
  ["Renata", "Renata"],
  ["Nunu & Willump", "Nunu"],
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

test("throws error when rune icon doesn't exist", async () => {
  await expect(validateRuneIcon("nonexistent.png")).rejects.toThrow(
    /Rune image nonexistent.png not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when augment icon doesn't exist", async () => {
  await expect(validateAugmentIcon("nonexistent.png")).rejects.toThrow(
    /Augment image nonexistent.png not found.*Run 'bun run update-data-dragon'/,
  );
});

test("formats item image url for valid item id", () => {
  const url = getItemImageUrl(3031);
  expect(url).toContain("/img/item/3031.png");
});

describe("getChampionDisplayNameById", () => {
  test("returns human display name with punctuation for known id", () => {
    expect(getChampionDisplayNameById(161)).toBe("Vel'Koz");
    expect(getChampionDisplayNameById(121)).toBe("Kha'Zix");
    expect(getChampionDisplayNameById(62)).toBe("Wukong");
    expect(getChampionDisplayNameById(4)).toBe("Twisted Fate");
  });

  test("returns fallback string for unknown id", () => {
    expect(getChampionDisplayNameById(999_999)).toBe("Champion 999999");
  });
});

describe("championNameToDisplayName", () => {
  test("resolves standard canonical key to display name", () => {
    expect(championNameToDisplayName("Velkoz")).toBe("Vel'Koz");
    expect(championNameToDisplayName("MonkeyKing")).toBe("Wukong");
  });
});

describe("champion normalization", () => {
  test.each(representativeChampions)(
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

  test("case-insensitive lookup against champion.json normalizes Riot quirks", () => {
    expect(normalizeChampionName("FiddleSticks")).toBe("Fiddlesticks");
    expect(normalizeChampionName("FIDDLESTICKS")).toBe("Fiddlesticks");
    expect(normalizeChampionName("fiddlesticks")).toBe("Fiddlesticks");
    expect(normalizeChampionName("Nunu & Willump")).toBe("Nunu");
    expect(normalizeChampionName("Nunu%20&%20Willump")).toBe("Nunu");
    expect(normalizeChampionName("nunu & willump")).toBe("Nunu");
    expect(normalizeChampionName("Wukong")).toBe("MonkeyKing");
    expect(normalizeChampionName("UnknownChamp")).toBe("UnknownChamp");
  });

  test.each(representativeChampions)(
    "validateChampionImage finds on-disk asset for input %s",
    async (input) => {
      await expect(validateChampionImage(input)).resolves.toBeUndefined();
    },
  );

  test.each(representativeChampions)(
    "getChampionImageUrl rewrites %s to the correct CDN path",
    (input, expected) => {
      expect(getChampionImageUrl(input)).toContain(
        `/img/champion/${expected}.png`,
      );
    },
  );

  test.each(representativeChampions)(
    "validateChampionLoadingImage finds loading art for input %s",
    async (input) => {
      await expect(
        validateChampionLoadingImage(input),
      ).resolves.toBeUndefined();
    },
  );

  test.each(representativeChampions)(
    "validateChampionSplashImage finds splash art for input %s",
    async (input) => {
      await expect(validateChampionSplashImage(input)).resolves.toBeUndefined();
    },
  );

  test.each(representativeChampions)(
    "getChampionLoadingImageUrl rewrites %s to the correct CDN path",
    (input, expected) => {
      expect(getChampionLoadingImageUrl(input, 0)).toContain(
        `/img/champion/loading/${expected}_0.jpg`,
      );
    },
  );

  test("getChampionLoadingImageBase64 returns a non-empty data URI for known champion", async () => {
    const dataUri = await getChampionLoadingImageBase64("Aatrox");
    expect(dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    const payload = dataUri.split(",", 2)[1] ?? "";
    expect(payload.length).toBeGreaterThan(100);
  });
});

describe("validateChampionLoadingImage missing asset", () => {
  test("throws pointing at update-data-dragon", async () => {
    await expect(
      validateChampionLoadingImage("NonExistentChampion"),
    ).rejects.toThrow(
      /Champion loading image for NonExistentChampion not found.*Run 'bun run update-data-dragon'/,
    );
  });
});

describe("validateChampionSplashImage missing asset", () => {
  test("throws pointing at update-data-dragon", async () => {
    await expect(
      validateChampionSplashImage("NonExistentChampion"),
    ).rejects.toThrow(
      /Champion splash image for NonExistentChampion not found.*Run 'bun run update-data-dragon'/,
    );
  });
});

describe("getChampionLoadingImageBase64 — missing asset", () => {
  test("missing base skin (champion absent) throws pointing at update-data-dragon", async () => {
    await expect(
      getChampionLoadingImageBase64("NonExistentChampion"),
    ).rejects.toThrow(
      /Image not found at .*\/champion-loading\/NonExistentChampion_0\.jpg.*Run 'bun run update-data-dragon'/,
    );
  });
});
