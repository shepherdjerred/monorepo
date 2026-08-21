import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  gameAssetManifest,
  getGameAsset,
  normalizeBrowserChampionKey,
} from "@scout-for-lol/data/browser-assets";
import {
  ChampionPortrait,
  gameAssetUrl,
  rankCrestUrl,
  resolveGameAssetUrl,
  SCOUT_GAME_ASSET_ROOT,
} from "./index.tsx";

describe("browser-safe Scout asset contract", () => {
  test("normalizes canonical champion IDs, keys, and encoded keys", () => {
    expect(normalizeBrowserChampionKey(266)).toBe("Aatrox");
    expect(normalizeBrowserChampionKey("aatrox")).toBe("Aatrox");
    expect(() => normalizeBrowserChampionKey("Aatrox%20")).toThrow(
      "Unknown champion key Aatrox%20",
    );
    expect(() => normalizeBrowserChampionKey("Aatrox%ZZ")).toThrow(
      "Unknown champion key Aatrox%ZZ",
    );
  });

  test("resolves versioned same-origin game and shared rank URLs", () => {
    const portrait = getGameAsset("champion", 266);
    expect(gameAssetUrl(portrait)).toBe(
      `${SCOUT_GAME_ASSET_ROOT}/img/champion/Aatrox.png`,
    );
    expect(resolveGameAssetUrl("spell", "SummonerBarrier")).toBe(
      `${SCOUT_GAME_ASSET_ROOT}/img/spell/SummonerBarrier.png`,
    );
    expect(resolveGameAssetUrl("champion-loading", 266)).toBe(
      `${SCOUT_GAME_ASSET_ROOT}/img/champion-loading/Aatrox_0.jpg`,
    );
    expect(resolveGameAssetUrl("champion-splash", "aatrox")).toBe(
      `${SCOUT_GAME_ASSET_ROOT}/img/champion-splash/Aatrox_0.jpg`,
    );
    expect(rankCrestUrl("Challenger")).toBe(
      "/assets/scout/shared/ranks/Rank=Challenger.png",
    );
  });

  test("manifest identities, source paths, and published URLs are unique", () => {
    const identities = new Set<string>();
    const paths = new Set<string>();
    const urls = new Set<string>();
    for (const asset of gameAssetManifest.assets) {
      identities.add(`${asset.kind}:${asset.canonicalId.toLowerCase()}`);
      paths.add(asset.relativePath);
      urls.add(gameAssetUrl(asset));
    }
    expect(identities.size).toBe(gameAssetManifest.assets.length);
    expect(paths.size).toBe(gameAssetManifest.assets.length);
    expect(urls.size).toBe(gameAssetManifest.assets.length);
  });

  test("unknown canonical assets remain contract errors", () => {
    expect(() => resolveGameAssetUrl("champion", "NotAChampion")).toThrow(
      "Unknown champion key NotAChampion",
    );
  });

  test("optional user champion data renders an explicit placeholder", () => {
    expect(
      renderToStaticMarkup(
        createElement(ChampionPortrait, {
          champion: "NotAChampion",
          optional: true,
        }),
      ),
    ).toContain('aria-label="Unknown champion"');
  });
});
