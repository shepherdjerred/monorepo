import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gameAssetManifest } from "@scout-for-lol/data/browser-assets";
import { GameFactSchema } from "@scout-for-lol/data/game-facts/schema.ts";
import {
  copyScoutAssets,
  decodeScoutAssetRequestUrl,
  resolveScoutAssetSource,
  scoutAssetStreamFailureAction,
  verifyScoutAssetBucket,
} from "./index.ts";

describe("Scout asset request URLs", () => {
  test("rejects malformed percent encoding at the request boundary", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/%ZZ.png")).toBeNull();
  });

  test("preserves valid encoded asset URLs", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/Brand%20Mark.svg")).toBe(
      "/assets/scout/Brand Mark.svg",
    );
  });

  test("keeps resolved asset sources inside their declared root", () => {
    const root = "/srv/scout-assets";
    expect(resolveScoutAssetSource(root, "img/champion/Aatrox.png")).toBe(
      resolve(root, "img/champion/Aatrox.png"),
    );
    expect(resolveScoutAssetSource(root, "/etc/passwd")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "../private.txt")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "")).toBeUndefined();
  });

  test("ends unopened responses and destroys responses already in flight", () => {
    expect(scoutAssetStreamFailureAction(false)).toBe("not-found");
    expect(scoutAssetStreamFailureAction(true)).toBe("destroy");
  });
});

describe("emitted game facts", () => {
  test("ship beside the game images at game/<patch>/facts/<kind>/<key>.json", async () => {
    const outputRoot = await mkdtemp(resolve(tmpdir(), "scout-assets-"));
    try {
      await copyScoutAssets(outputRoot);
      await verifyScoutAssetBucket(outputRoot);
      const gameRoot = resolve(
        outputRoot,
        "assets/scout/game",
        gameAssetManifest.sourceVersion,
      );
      const samples = [
        ["champion", "Ahri"],
        ["ability", "Ahri-E"],
        ["item", "3118"],
        ["rune", "8112"],
        ["summoner-spell", "14"],
      ] as const;
      for (const [kind, key] of samples) {
        const fact = GameFactSchema.parse(
          await Bun.file(resolve(gameRoot, `facts/${kind}/${key}.json`)).json(),
        );
        expect(`${fact.kind}/${fact.key}`).toBe(`${kind}/${key}`);
        expect(fact.patch).toBe(gameAssetManifest.sourceVersion);
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
