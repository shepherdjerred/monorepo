import { describe, expect, test } from "bun:test";
import { getGameAsset, normalizeBrowserChampionKey } from "./browser-assets.ts";

describe("browser champion assets", () => {
  test.each([
    [
      "Akali",
      "champion:akali",
      "champion-loading:akali_0",
      "champion-splash:akali_0",
    ],
    [
      "Jade_Akali",
      "champion:jade_akali",
      "champion-loading:jade_akali_0",
      "champion-splash:jade_akali_0",
    ],
  ])(
    "resolves the %s asset family from the manifest",
    (key, portrait, loading, splash) => {
      expect(normalizeBrowserChampionKey(key)).toBe(key);
      expect(
        `${getGameAsset("champion", key).kind}:${getGameAsset("champion", key).canonicalId.toLowerCase()}`,
      ).toBe(portrait);
      expect(
        `${getGameAsset("champion-loading", key).kind}:${getGameAsset("champion-loading", key).canonicalId.toLowerCase()}`,
      ).toBe(loading);
      expect(
        `${getGameAsset("champion-splash", key).kind}:${getGameAsset("champion-splash", key).canonicalId.toLowerCase()}`,
      ).toBe(splash);
    },
  );
});
