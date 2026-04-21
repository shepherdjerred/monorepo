import { describe, expect, test } from "bun:test";
import {
  getChampionImage,
  getChampionLoadingImage,
  preloadChampionImages,
  preloadChampionLoadingImages,
} from "./image-cache.ts";

describe("image-cache", () => {
  // The cache stores base64 data URIs keyed by the EXACT string the caller
  // passed in — it does not re-normalize. Callers (backend) must pass the
  // output of `resolveChampionKey`, which already normalizes. These tests
  // pin that contract for the camelCase champions the loading-screen
  // feature has to deal with.

  test("preload + get with normalized camelCase key (RekSai)", async () => {
    await preloadChampionImages(["RekSai"]);
    const dataUri = getChampionImage("RekSai");
    expect(dataUri).toStartWith("data:image/png;base64,");
    expect(dataUri.length).toBeGreaterThan(200);
  });

  test("preload + get with override input (Reksai) — getter uses same input", async () => {
    // When upstream accidentally passes the non-normalized form, the
    // cache resolves the file correctly (normalizeChampionName is called
    // inside getChampionImageBase64) but the cache key is the raw input.
    // Retrieval must use the same string.
    await preloadChampionImages(["Reksai"]);
    const dataUri = getChampionImage("Reksai");
    expect(dataUri).toStartWith("data:image/png;base64,");
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
