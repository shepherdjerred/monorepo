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
import {
  bunReportFonts,
  containsCjkText,
} from "@scout-for-lol/design-system/satori/fonts";
import {
  preloadChampionImages,
  preloadChampionSplashImages,
} from "#src/dataDragon/image-cache.ts";

export type MatchRenderOptions = {
  /**
   * Force a specific ranked design rather than the hash-derived pick. Only
   * applies when the queue is ranked solo/flex; ignored otherwise.
   */
  designOverride?: RankedDesign;
  /**
   * Gate the new ranked banner/square designs. When `false`, ranked solo/flex
   * matches fall back to the legacy 4760×3500 report. Defaults to `true`.
   * The backend sets this to `false` outside local dev so the redesign stays
   * local-only until it's promoted.
   */
  enableRankedDesigns?: boolean;
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

  const fonts = await bunReportFonts(containsCjkText(match), match);

  const rankedDesignsEnabled = options.enableRankedDesigns ?? true;
  if (
    rankedDesignsEnabled &&
    isRankedQueue(match.queueType) &&
    match.players.length > 0
  ) {
    const design = options.designOverride ?? pickRankedDesign(match);
    const hero = heroPlayer(match.players);
    await preloadChampionSplashImages([hero.champion.championName]);

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
    width: STANDARD_REPORT_WIDTH,
    height: standardReportHeight(match),
    fonts,
  });
}

const STANDARD_REPORT_WIDTH = 4760;
/** Canvas height for a full ten-player report. */
const STANDARD_REPORT_HEIGHT_10 = 3500;
/**
 * Vertical distance between two champion rows: a 202px row plus a 64px (4rem)
 * gap, measured off the committed 5v5 baseline. The per-team block checks out
 * as 101 (team header) + 64 (gap) + 5 * 202 + 4 * 64 = 1431, and two of those
 * plus the 96px (6rem) inter-team gap is the 2958px teams container.
 */
const CHAMPION_ROW_STRIDE = 266;
const FULL_LOBBY_SIZE = 10;

/**
 * Height of the legacy report canvas for the roster it actually holds.
 *
 * A tournament-code custom lobby can be as small as 1v1, and a fixed 3500px
 * canvas would leave most of the image empty. At ten players this returns
 * exactly STANDARD_REPORT_HEIGHT_10, so every committed baseline is unchanged
 * by construction — `layout-routing`-style tests pin that.
 *
 * The width deliberately stays 4760 even though the inner gradient is 4864 and
 * already clips 104px horizontally. Widening it would rewrite every baseline.
 */
export function standardReportHeight(match: CompletedMatch): number {
  const total = match.teams.blue.length + match.teams.red.length;
  return (
    STANDARD_REPORT_HEIGHT_10 - (FULL_LOBBY_SIZE - total) * CHAMPION_ROW_STRIDE
  );
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
  if (bbox && options.crop !== false) {
    resvg.cropByBBox(bbox);
  }

  const pngData = resvg.render();
  return pngData.asPng();
}
