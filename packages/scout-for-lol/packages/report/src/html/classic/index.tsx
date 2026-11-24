import satori from "satori";
import type { ClassicMatch } from "@scout-for-lol/data";
import { bunClassicFonts } from "@scout-for-lol/design-system/satori/classic-fonts";
import {
  bunCjkFonts,
  containsCjkText,
} from "@scout-for-lol/design-system/satori/fonts";
import {
  preloadChampionImages,
  preloadChampionSplashImages,
} from "#src/dataDragon/image-cache.ts";
import { svgToPngInThread } from "#src/html/index.tsx";
import {
  runPngRenderInWorker,
  runSvgRenderInWorker,
} from "#src/html/render-worker-client.ts";
import { isRenderWorkerThread } from "#src/html/render-worker-protocol.ts";
import {
  ClassicMatchReport,
  CLASSIC_MATCH_WIDTH,
  classicMatchHeight,
} from "./report.tsx";

export async function classicMatchToSvgInThread(
  match: ClassicMatch,
): Promise<string> {
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

export async function classicMatchToImageInThread(
  match: ClassicMatch,
): Promise<Buffer> {
  return await svgToPngInThread(await classicMatchToSvgInThread(match), {
    crop: false,
  });
}

export async function classicMatchToSvg(match: ClassicMatch): Promise<string> {
  return isRenderWorkerThread()
    ? await classicMatchToSvgInThread(match)
    : await runSvgRenderInWorker({ kind: "classicMatchToSvg", match });
}

export async function classicMatchToImage(
  match: ClassicMatch,
): Promise<Buffer> {
  return isRenderWorkerThread()
    ? await classicMatchToImageInThread(match)
    : await runPngRenderInWorker({ kind: "classicMatchToImage", match });
}
