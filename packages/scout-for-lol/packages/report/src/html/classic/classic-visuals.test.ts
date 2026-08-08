import { describe, expect, test } from "bun:test";
import { bunClassicFonts } from "#src/assets/classic-fonts.ts";
import { classicTypography } from "#src/assets/classic-style.ts";
import {
  classicLoadingScreenFixture,
  classicMatchFixture,
} from "#src/testing/classic-fixtures.ts";
import {
  loadingScreenToImage,
  loadingScreenToSvg,
} from "#src/html/loading-screen/index.tsx";
import { classicMatchToImage, classicMatchToSvg } from "./index.tsx";

// These tests exercise the *committed* Classic fonts through the real
// production render path (`bunClassicFonts()` -> satori -> resvg), so the
// normal Scout/report test lane fails fast if a Gill Sans (or QTFrizQuad)
// asset is omitted, empty, or unparseable — the guarantee that the deleted
// standalone `scout-classic-visuals` Buildkite lane used to provide.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

describe("Classic committed fonts", () => {
  test("bunClassicFonts loads all four committed faces with real bytes", async () => {
    const fonts = await bunClassicFonts();

    // Two weights each for the display (QTFrizQuad) and body (Gill Sans)
    // families — the four committed files.
    expect(fonts).toHaveLength(4);

    for (const font of fonts) {
      expect(font.data.byteLength).toBeGreaterThan(0);
    }

    const byFamily = (family: string): number[] =>
      fonts
        .filter((font) => font.name === family)
        .map((font) => font.weight ?? 0)
        .sort((a, b) => a - b);

    expect(byFamily(classicTypography.family.display)).toEqual([400, 700]);
    // The committed Gill Sans body faces — the asset this PR moves in-tree.
    expect(byFamily(classicTypography.family.body)).toEqual([400, 700]);
  });
});

describe("Classic report renders with committed fonts", () => {
  test("postmatch renders deterministically at the approved dimensions", async () => {
    const match = classicMatchFixture();
    const svg = await classicMatchToSvg(match);
    const repeat = await classicMatchToSvg(match);

    expect(svg).toBe(repeat);
    expect(svg).toStartWith("<svg ");
    expect(svg).toContain('width="1920" height="1200"');
  });

  test.each(["classic", "classic aram mayhem"] as const)(
    "%s postmatch uses the deterministic Classic renderer",
    async (queueType) => {
      const match = classicMatchFixture(5, 5, "Victory", { queueType });
      const svg = await classicMatchToSvg(match);
      const repeat = await classicMatchToSvg(match);

      expect(svg).toBe(repeat);
      expect(svg).toContain('width="1920" height="1200"');
    },
  );

  test("Victory, Defeat, and Surrender produce distinct reports", async () => {
    const outcomes = ["Victory", "Defeat", "Surrender"] as const;
    const svgs = await Promise.all(
      outcomes.map((outcome) =>
        classicMatchToSvg(classicMatchFixture(5, 5, outcome)),
      ),
    );

    expect(new Set(svgs).size).toBe(outcomes.length);
  });

  test("postmatch rasterizes to a valid PNG", async () => {
    const png = await classicMatchToImage(classicMatchFixture());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  test("classic loading screen renders at the approved dimensions", async () => {
    const svg = await loadingScreenToSvg(classicLoadingScreenFixture());
    expect(svg).toStartWith("<svg ");
    expect(svg).toContain('width="1920" height="1280"');
  });

  test("classic loading screen rasterizes to a valid PNG", async () => {
    const png = await loadingScreenToImage(classicLoadingScreenFixture());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  // Partial team compositions (e.g. a 3v2 remake/early-surrender) exercise a
  // different layout path than the full 5v5 fixtures above. The deleted
  // standalone `scout-classic-visuals` lane covered these; keep that coverage
  // in the normal lane so partial-count rasterization regressions still fail CI.
  test("postmatch renders a partial 3v2 composition deterministically to a valid PNG", async () => {
    const match = classicMatchFixture(3, 2);
    const svg = await classicMatchToSvg(match);
    const repeat = await classicMatchToSvg(match);

    expect(svg).toBe(repeat);
    expect(svg).toStartWith("<svg ");
    // The scoreboard height scales with the number of rendered rows, so a
    // partial roster is intentionally shorter than the full 5v5 report; only
    // the fixed report width is asserted here.
    expect(svg).toContain('width="1920"');

    const png = await classicMatchToImage(match);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  test("classic loading screen renders a partial 3v2 lobby to a valid PNG", async () => {
    const partial = classicLoadingScreenFixture(3, 2);
    const svg = await loadingScreenToSvg(partial);

    expect(svg).toStartWith("<svg ");
    expect(svg).toContain('width="1920" height="1280"');

    const png = await loadingScreenToImage(partial);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});
