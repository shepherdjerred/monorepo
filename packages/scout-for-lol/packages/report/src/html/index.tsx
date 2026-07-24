import satori from "satori";
import type { CompletedMatch } from "@scout-for-lol/data";
import { Report } from "#src/html/report.tsx";
import {
  RankedBannerReport,
  BANNER_WIDTH,
  BANNER_HEIGHT,
} from "#src/html/ranked-banner/report.tsx";
import {
  RankedSquareReport,
  SQUARE_WIDTH,
  SQUARE_HEIGHT,
} from "#src/html/ranked-square/report.tsx";
import {
  isRankedQueue,
  pickRankedDesign,
  type RankedDesign,
} from "#src/html/shared/pick-design.ts";
import { heroPlayer } from "#src/html/shared/grade.ts";
import { bunBeaufortFonts, bunSpiegelFonts } from "#src/assets/index.ts";
import {
  preloadChampionImages,
  preloadChampionLoadingImages,
} from "#src/dataDragon/image-cache.ts";

export type MatchRenderOptions = {
  /**
   * Force a specific ranked design rather than the hash-derived pick. Only
   * applies when the queue is ranked solo/flex; ignored otherwise.
   */
  designOverride?: RankedDesign;
};

export async function matchToImage(
  match: CompletedMatch,
  options: MatchRenderOptions = {},
): Promise<Buffer> {
  const svg = await matchToSvg(match, options);
  const png = await svgToPng(svg);
  return png;
}

export async function matchToSvg(
  match: CompletedMatch,
  options: MatchRenderOptions = {},
): Promise<string> {
  await preloadChampionImages([
    ...match.teams.blue.map((champion) => champion.championName),
    ...match.teams.red.map((champion) => champion.championName),
  ]);

  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];

  if (isRankedQueue(match.queueType) && match.players.length > 0) {
    const design = options.designOverride ?? pickRankedDesign(match);
    const hero = heroPlayer(match.players);
    await preloadChampionLoadingImages([
      { championName: hero.champion.championName, skinNum: 0 },
    ]);

    if (design === "banner") {
      return satori(<RankedBannerReport match={match} />, {
        width: BANNER_WIDTH,
        height: BANNER_HEIGHT,
        fonts,
      });
    }
    return satori(<RankedSquareReport match={match} />, {
      width: SQUARE_WIDTH,
      height: SQUARE_HEIGHT,
      fonts,
    });
  }

  return satori(<Report match={match} />, {
    width: 4760,
    height: 3500,
    fonts,
  });
}

export async function svgToPng(
  svg: string,
  options: { crop?: boolean } = {},
): Promise<Buffer> {
  // Lazy load resvg only when needed (server-side only)
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    dpi: 600,
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    fitTo: {
      mode: "original",
    },
    font: {
      loadSystemFonts: false,
    },
  });

  // Automatically crop to bounding box to remove transparent background
  const bbox = resvg.getBBox();
  if (options.crop !== false && bbox) {
    resvg.cropByBBox(bbox);
  }

  const pngData = resvg.render();
  return pngData.asPng();
}
