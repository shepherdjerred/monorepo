import { describe, expect, test } from "bun:test";
import {
  assertSnapshotUpdateSucceeded,
  resolveCDragonAssetUrl,
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
    const url = resolveCDragonAssetUrl(cdragonPath);
    expect(url).toBe(
      "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/fiddlesticks/skins/skin27/fiddlesticksloadscreen_27.jpg",
    );
  });

  test("handles a path that omits the /lol-game-data/assets prefix", () => {
    const url = resolveCDragonAssetUrl(
      "/assets/characters/aatrox/skins/skin0/aatroxloadscreen_0.jpg",
    );
    expect(url).toBe(
      "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/aatrox/skins/skin0/aatroxloadscreen_0.jpg",
    );
  });

  test("lowercases mixed-case path components", () => {
    const url = resolveCDragonAssetUrl(
      "/lol-game-data/assets/ASSETS/Characters/MissFortune/Skins/Skin99/MissFortuneLoadScreen_99.JPG",
    );
    expect(url).toContain(
      "/assets/characters/missfortune/skins/skin99/missfortuneloadscreen_99.jpg",
    );
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
