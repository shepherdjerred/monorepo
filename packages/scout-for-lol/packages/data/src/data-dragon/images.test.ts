import { test, expect } from "bun:test";
import {
  getChampionImageUrl,
  getItemImageUrl,
  validateChampionImage,
  validateItemImage,
  validateSpellImage,
  validateRuneIcon,
  validateAugmentIcon,
} from "./images.ts";

test("throws error when champion image doesn't exist", async () => {
  await expect(validateChampionImage("NonExistentChampion")).rejects.toThrow(
    /Champion image for NonExistentChampion not found.*Run 'bun run update-data-dragon'/,
  );
});

test("throws error when item image doesn't exist", async () => {
  await expect(validateItemImage(99999)).rejects.toThrow(
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

test("validates FiddleSticks with capital S normalizes to Fiddlesticks", async () => {
  await expect(validateChampionImage("FiddleSticks")).resolves.toBeUndefined();
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
