import { describe, expect, test } from "bun:test";
import {
  assertSnapshotUpdateSucceeded,
  classicCatalogEntryFromCDragon,
  getCDragonCenteredSplashUrl,
  getCommunityDragonVersion,
  mergeClassicChampionEntries,
  resolveCDragonAssetUrl,
  validateClassicMetadata,
} from "./update-data-dragon.ts";
import { ChampionListSchema } from "./update-data-dragon-schemas.ts";

describe("resolveCDragonAssetUrl", () => {
  // Recipe: take the `loadScreenPath` from CommunityDragon's per-champion JSON,
  // lowercase, strip `/lol-game-data/assets`, then prepend the rcp-be plugin
  // path. Verified live against Star Nemesis Fiddlesticks (HTTP 200, ~49 KB)
  // and Praetorian Fiddlesticks (HTTP 200, ~39 KB) on 2026-04-25.

  test("rewrites a Star Nemesis Fiddlesticks loadScreenPath to a fetchable URL", () => {
    const cdragonPath =
      "/lol-game-data/assets/ASSETS/Characters/Fiddlesticks/Skins/Skin27/FiddleSticksLoadscreen_27.jpg";
    const url = resolveCDragonAssetUrl("16.16", cdragonPath);
    expect(url).toBe(
      "https://raw.communitydragon.org/16.16/plugins/rcp-be-lol-game-data/global/default/assets/characters/fiddlesticks/skins/skin27/fiddlesticksloadscreen_27.jpg",
    );
  });

  test("handles a path that omits the /lol-game-data/assets prefix", () => {
    const url = resolveCDragonAssetUrl(
      "16.16",
      "/assets/characters/aatrox/skins/skin0/aatroxloadscreen_0.jpg",
    );
    expect(url).toBe(
      "https://raw.communitydragon.org/16.16/plugins/rcp-be-lol-game-data/global/default/assets/characters/aatrox/skins/skin0/aatroxloadscreen_0.jpg",
    );
  });

  test("lowercases mixed-case path components", () => {
    const url = resolveCDragonAssetUrl(
      "16.16",
      "/lol-game-data/assets/ASSETS/Characters/MissFortune/Skins/Skin99/MissFortuneLoadScreen_99.JPG",
    );
    expect(url).toContain(
      "/assets/characters/missfortune/skins/skin99/missfortuneloadscreen_99.jpg",
    );
  });

  test("pins the version for centered splash art", () => {
    expect(getCDragonCenteredSplashUrl("16.16.1", 60084, 0)).toBe(
      "https://cdn.communitydragon.org/16.16.1/champion/60084/splash-art/centered/skin/0",
    );
  });

  test("derives the raw CommunityDragon version from Data Dragon", () => {
    expect(getCommunityDragonVersion("16.16.1")).toBe("16.16");
  });
});

describe("ChampionListSchema", () => {
  test("rejects a nonnumeric champion key", () => {
    const result = ChampionListSchema.safeParse({
      data: {
        InvalidChampion: {
          id: "InvalidChampion",
          key: "not-a-number",
          name: "Invalid Champion",
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("Classic catalog refresh", () => {
  const modern = {
    id: "Akali",
    key: "84",
    name: "Akali",
  };
  const cdragon = {
    id: 60084,
    alias: "Jade_Akali",
    name: "Akali",
    relatedPrimeItemId: 84,
    squarePortraitPath: "/lol-game-data/assets/v1/champion-icons/60084.png",
    skins: [
      {
        id: 60084000,
        loadScreenPath: "/lol-game-data/assets/Characters/Jade_Akali.jpg",
      },
    ],
  };

  test("turns a discovered CommunityDragon champion into a catalog entry", () => {
    expect(classicCatalogEntryFromCDragon(modern, cdragon)).toEqual({
      id: "Jade_Akali",
      key: "60084",
      name: "Akali",
      modernKey: "84",
    });
  });

  test("rejects mismatched CommunityDragon metadata", () => {
    expect(() =>
      validateClassicMetadata(modern, { ...cdragon, relatedPrimeItemId: 85 }),
    ).toThrow("Classic metadata mismatch");
  });

  test("preserves historical entries while adding discovered entries", () => {
    const normal = ChampionListSchema.parse({ data: { Akali: modern } });
    const historical = ChampionListSchema.parse({
      data: {
        Jade_Akali: {
          id: "Jade_Akali",
          key: "60084",
          name: "Akali",
          modernKey: "84",
        },
      },
    });
    const merged = mergeClassicChampionEntries(normal, historical, [
      classicCatalogEntryFromCDragon(modern, cdragon),
    ]);
    expect(merged.data["Akali"]?.key).toBe("84");
    expect(merged.data["Jade_Akali"]?.key).toBe("60084");
  });
});

describe("assertSnapshotUpdateSucceeded", () => {
  test("accepts a successful snapshot update", () => {
    expect(() => {
      assertSnapshotUpdateSucceeded("ranked-banner.test.ts", 0, "");
    }).not.toThrow();
  });

  test("propagates a failed ranked snapshot update", () => {
    expect(() => {
      assertSnapshotUpdateSucceeded(
        "ranked-square/square.integration.test.ts",
        1,
        "snapshot mismatch",
      );
    }).toThrow(
      "Snapshot update failed for ranked-square/square.integration.test.ts (exit 1): snapshot mismatch",
    );
  });
});
