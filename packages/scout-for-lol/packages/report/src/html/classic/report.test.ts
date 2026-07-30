import { describe, expect, test } from "bun:test";
import satori, { type Font } from "satori";
import type { ClassicMatch } from "@scout-for-lol/data";
import { classicTypography } from "#src/assets/classic-style.ts";
import {
  preloadChampionImages,
  preloadChampionSplashImages,
} from "#src/dataDragon/image-cache.ts";
import { classicMatchFixture } from "#src/testing/classic-fixtures.ts";
import {
  ClassicMatchReport,
  CLASSIC_MATCH_BASE_HEIGHT,
  CLASSIC_MATCH_ROW_HEIGHT,
  CLASSIC_MATCH_WIDTH,
  classicMatchHeight,
} from "./report.tsx";

async function testClassicFonts(): Promise<Font[]> {
  const regular = await Bun.file(
    new URL("../../assets/fonts/QTFrizQuad/QTFrizQuad.otf", import.meta.url),
  ).arrayBuffer();
  const bold = await Bun.file(
    new URL(
      "../../assets/fonts/QTFrizQuad/QTFrizQuad-Bold.otf",
      import.meta.url,
    ),
  ).arrayBuffer();
  return [
    {
      name: classicTypography.family.display,
      data: regular,
      weight: 400,
      style: "normal",
    },
    {
      name: classicTypography.family.display,
      data: bold,
      weight: 700,
      style: "normal",
    },
    {
      name: classicTypography.family.body,
      data: regular,
      weight: 400,
      style: "normal",
    },
    {
      name: classicTypography.family.body,
      data: bold,
      weight: 700,
      style: "normal",
    },
  ];
}

async function renderClassicText(match: ClassicMatch): Promise<string> {
  const championNames = [
    ...match.teams.blue.map((champion) => champion.championName),
    ...match.teams.red.map((champion) => champion.championName),
  ];
  const hero = match.players[0];
  if (hero === undefined) {
    throw new Error("Classic match test fixture has no tracked player");
  }
  await Promise.all([
    preloadChampionImages(championNames),
    preloadChampionSplashImages([hero.champion.championName]),
  ]);
  return satori(ClassicMatchReport({ match }), {
    width: CLASSIC_MATCH_WIDTH,
    height: classicMatchHeight(match),
    fonts: await testClassicFonts(),
    embedFont: false,
  });
}

describe("Classic match report geometry", () => {
  test("uses the approved fixed width and roster-dependent height", () => {
    const match = classicMatchFixture();
    expect(CLASSIC_MATCH_WIDTH).toBe(1920);
    expect(classicMatchHeight(match)).toBe(
      CLASSIC_MATCH_BASE_HEIGHT +
        CLASSIC_MATCH_ROW_HEIGHT *
          (match.teams.blue.length + match.teams.red.length),
    );
    expect(classicMatchHeight(match)).toBe(1200);
  });

  test("displays champion names instead of Classic asset keys", async () => {
    const svg = await renderClassicText(classicMatchFixture(1, 2));

    expect(svg).toContain(">Ahri</text>");
    expect(svg).toContain(">Blitzcrank</text>");
    expect(svg).not.toContain("Jade_");
  });
});
