import { describe, expect, test } from "bun:test";
import {
  getChampionImage,
  getChampionLoadingImage,
  preloadChampionImages,
  preloadChampionLoadingImages,
} from "./image-cache.ts";

describe("image-cache", () => {
  // Cache normalizes champion names on both `set` and `get`, so any
  // casing variant the caller passes (Riot match-data quirks like
  // "FiddleSticks", twisted-vs-DataDragon drift like "Reksai") resolves
  // to the canonical entry. These tests pin that round-trip contract.

  test("preload + get with normalized camelCase key (RekSai)", async () => {
    await preloadChampionImages(["RekSai"]);
    const dataUri = getChampionImage("RekSai");
    expect(dataUri).toStartWith("data:image/png;base64,");
    expect(dataUri.length).toBeGreaterThan(200);
  });

  test("preload + get round-trip across casings (Reksai ↔ RekSai)", async () => {
    // The override map rewrites Reksai → RekSai; both casings hit the
    // same cache entry whether the caller used the override input or the
    // canonical form.
    await preloadChampionImages(["Reksai"]);
    expect(getChampionImage("Reksai")).toStartWith("data:image/png;base64,");
    expect(getChampionImage("RekSai")).toStartWith("data:image/png;base64,");
  });

  test("preload + get round-trip across Riot quirk casing (FiddleSticks ↔ Fiddlesticks)", async () => {
    // Riot's match data API returns "FiddleSticks" (capital S) for
    // Fiddlesticks. The cache must resolve both casings to the same
    // canonical entry so report rendering doesn't throw.
    await preloadChampionImages(["FiddleSticks"]);
    expect(getChampionImage("FiddleSticks")).toStartWith(
      "data:image/png;base64,",
    );
    expect(getChampionImage("Fiddlesticks")).toStartWith(
      "data:image/png;base64,",
    );
    expect(getChampionImage("FIDDLESTICKS")).toStartWith(
      "data:image/png;base64,",
    );
  });

  test("preload + get champion loading image for RekSai", async () => {
    await preloadChampionLoadingImages([
      { championName: "RekSai", skinNum: 0 },
    ]);
    const dataUri = getChampionLoadingImage("RekSai", 0);
    expect(dataUri).toStartWith("data:image/jpeg;base64,");
    expect(dataUri.length).toBeGreaterThan(200);
  });

  test("preload + get champion loading image for KSante", async () => {
    await preloadChampionLoadingImages([
      { championName: "KSante", skinNum: 0 },
    ]);
    const dataUri = getChampionLoadingImage("KSante", 0);
    expect(dataUri).toStartWith("data:image/jpeg;base64,");
  });

  test("preload + get champion loading image for JarvanIV", async () => {
    await preloadChampionLoadingImages([
      { championName: "JarvanIV", skinNum: 0 },
    ]);
    const dataUri = getChampionLoadingImage("JarvanIV", 0);
    expect(dataUri).toStartWith("data:image/jpeg;base64,");
  });

  test("getChampionImage throws when not pre-loaded", () => {
    expect(() => getChampionImage("AZZZThisIsDefinitelyNotCached")).toThrow(
      /not found in cache/,
    );
  });

  test("getChampionLoadingImage throws when not pre-loaded", () => {
    expect(() =>
      getChampionLoadingImage("AZZZThisIsDefinitelyNotCached", 99),
    ).toThrow(/not found in cache/);
  });
});
