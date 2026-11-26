import { describe, expect, test } from "vitest";
import {
  championSplashFacing,
  gameAssetManifest,
  getSplashFacing,
  presentSplash,
  splashPresentation,
} from "#src/browser-assets.ts";
import {
  ChampionSplashFacingEntrySchema,
  ChampionSplashFacingSchema,
} from "#src/data-dragon/champion-splash-facing.ts";

const sha = "a".repeat(64);
const entry = {
  facing: "left",
  focusX: 0.4,
  mirrorSafe: true,
  imageSha256: sha,
  source: "model",
  confidence: "high",
  note: "",
} as const;

describe("champion splash facing schema", () => {
  test("accepts a complete entry", () => {
    expect(ChampionSplashFacingEntrySchema.parse(entry)).toEqual(entry);
  });

  test.each([
    ["facing outside left/right/center", { ...entry, facing: "up" }],
    ["focusX below 0", { ...entry, focusX: -0.1 }],
    ["focusX above 1", { ...entry, focusX: 1.1 }],
    ["a non-hex sha", { ...entry, imageSha256: "xyz" }],
    ["an unknown source", { ...entry, source: "guess" }],
    ["a missing mirrorSafe", { ...entry, mirrorSafe: undefined }],
    ["a note with a stray brace", { ...entry, note: "reads wrong.}" }],
  ])("rejects %s", (_label, value) => {
    expect(ChampionSplashFacingEntrySchema.safeParse(value).success).toBe(
      false,
    );
  });

  test("keys entries by splash file name", () => {
    expect(
      ChampionSplashFacingSchema.safeParse({
        version: 1,
        entries: { "Ahri_0.jpg": entry },
      }).success,
    ).toBe(true);
    expect(
      ChampionSplashFacingSchema.safeParse({
        version: 1,
        entries: { Ahri: entry },
      }).success,
    ).toBe(false);
  });
});

const facing = (value: "left" | "right" | "center", mirrorSafe = true) => ({
  facing: value,
  focusX: 0.3,
  mirrorSafe,
});

describe("presentSplash", () => {
  test("keeps a champion that faces the centre as is", () => {
    expect(presentSplash(facing("right"), "left")).toEqual({
      mirrored: false,
      focusX: 0.3,
    });
    expect(presentSplash(facing("left"), "right")).toEqual({
      mirrored: false,
      focusX: 0.3,
    });
  });

  test("mirrors a champion that faces away from the centre", () => {
    expect(presentSplash(facing("left"), "left")).toEqual({
      mirrored: true,
      focusX: 0.7,
    });
    expect(presentSplash(facing("right"), "right")).toEqual({
      mirrored: true,
      focusX: 0.7,
    });
  });

  test("never mirrors a centre-facing champion", () => {
    expect(presentSplash(facing("center"), "left").mirrored).toBe(false);
    expect(presentSplash(facing("center"), "right").mirrored).toBe(false);
  });

  test("never mirrors art that is not mirror-safe", () => {
    expect(presentSplash(facing("left", false), "left")).toEqual({
      mirrored: false,
      focusX: 0.3,
    });
    expect(presentSplash(facing("right", false), "right").mirrored).toBe(false);
  });
});

describe("splashPresentation", () => {
  test("two champions can face each other", () => {
    // Ahri faces left in her art, so on the left of the page she is mirrored;
    // Syndra on the right is mirrored only if her art faces right.
    const ahri = splashPresentation("Ahri", "left");
    expect(getSplashFacing("Ahri").facing).toBe("left");
    expect(ahri.mirrored).toBe(true);
  });

  test("accepts a champion id and a classic variant", () => {
    expect(splashPresentation(103, "left")).toEqual(
      splashPresentation("Ahri", "left"),
    );
    expect(splashPresentation("Jade_Ahri", "right").focusX).toBeGreaterThan(0);
  });

  test("fails loudly for an unknown champion", () => {
    expect(() => splashPresentation("NotAChampion", "left")).toThrow(
      /Unknown champion key/,
    );
  });
});

describe("committed splash facing metadata", () => {
  const splashes = gameAssetManifest.assets.filter(
    (asset) => asset.kind === "champion-splash",
  );

  test("covers every splash in the manifest", () => {
    expect(splashes.length).toBeGreaterThan(0);
    const missing = splashes
      .filter(
        (asset) =>
          championSplashFacing.entries[`${asset.canonicalId}.jpg`] ===
          undefined,
      )
      .map((asset) => asset.canonicalId);
    expect(missing).toEqual([]);
  });

  test("describes the exact image bytes in the manifest", () => {
    const stale = splashes
      .filter(
        (asset) =>
          championSplashFacing.entries[`${asset.canonicalId}.jpg`]
            ?.imageSha256 !== asset.sha256,
      )
      .map((asset) => asset.canonicalId);
    expect(stale).toEqual([]);
  });

  test("has no entry for a splash that no longer exists", () => {
    const known = new Set(splashes.map((asset) => `${asset.canonicalId}.jpg`));
    const orphaned = Object.keys(championSplashFacing.entries).filter(
      (file) => !known.has(file),
    );
    expect(orphaned).toEqual([]);
  });
});
