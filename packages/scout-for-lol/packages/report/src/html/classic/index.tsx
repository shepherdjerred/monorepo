import satori from "satori";
import type { ClassicMatch } from "@scout-for-lol/data";
import { bunClassicFonts } from "#src/assets/classic-fonts.ts";
import { bunCjkFonts, containsCjkText } from "#src/assets/index.ts";
import {
  preloadChampionImages,
  preloadChampionSplashImages,
} from "#src/dataDragon/image-cache.ts";
import { svgToPng } from "#src/html/index.tsx";
import {
  ClassicMatchReport,
  CLASSIC_MATCH_WIDTH,
  classicMatchHeight,
} from "./report.tsx";

export async function classicMatchToSvg(match: ClassicMatch): Promise<string> {
  const championNames = [
    ...match.teams.blue.map((champion) => champion.championName),
    ...match.teams.red.map((champion) => champion.championName),
  ];
  const hero = match.players[0];
  if (hero === undefined) {
    throw new Error("Classic match requires at least one tracked player");
  }
  await Promise.all([
    preloadChampionImages(championNames),
    preloadChampionSplashImages([hero.champion.championName]),
  ]);
  const fonts = [
    ...(await bunClassicFonts()),
    ...(containsCjkText(match) ? await bunCjkFonts(match) : []),
  ];
  return satori(<ClassicMatchReport match={match} />, {
    width: CLASSIC_MATCH_WIDTH,
    height: classicMatchHeight(match),
    fonts,
  });
}

export async function classicMatchToImage(
  match: ClassicMatch,
): Promise<Buffer> {
  return svgToPng(await classicMatchToSvg(match), { crop: false });
}
