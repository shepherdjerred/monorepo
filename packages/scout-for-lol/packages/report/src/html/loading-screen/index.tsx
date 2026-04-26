import satori from "satori";
import type { LoadingScreenData, SkinFallbackEvent } from "@scout-for-lol/data";
import { LoadingScreen } from "#src/html/loading-screen/loading-screen.tsx";
import { bunBeaufortFonts, bunSpiegelFonts } from "#src/assets/index.ts";
import {
  preloadChampionLoadingImages,
  preloadChampionImages,
} from "#src/dataDragon/image-cache.ts";
import { svgToPng } from "#src/html/index.tsx";

// Standard/ARAM: 5 cards per row × 2 rows + header/bans
const STANDARD_WIDTH = 1600;
const STANDARD_HEIGHT = 1350;
// Arena: 4 rows × 2 team pairs
const ARENA_WIDTH = 1600;
const ARENA_HEIGHT = 1400;

/**
 * Optional observability hook fired when a participant's requested skin
 * loading-screen JPG isn't on disk and we fall back to skin 0. Backend
 * callers wire this to a Prometheus counter + structured log.
 */
export type LoadingScreenOptions = {
  onSkinFallback?: (event: SkinFallbackEvent) => void;
};

async function preloadLoadingScreenImages(
  data: LoadingScreenData,
  options: LoadingScreenOptions = {},
): Promise<void> {
  // Preload champion loading screen art for all participants
  const loadingImageEntries = data.participants.map((p) => ({
    championName: p.championName,
    skinNum: p.skinNum,
  }));
  await preloadChampionLoadingImages(
    loadingImageEntries,
    options.onSkinFallback,
  );

  // Preload small champion square portraits for bans
  if (data.bans.length > 0) {
    const banChampionNames = data.bans.map((b) => b.championName);
    await preloadChampionImages(banChampionNames);
  }
}

export async function loadingScreenToSvg(
  data: LoadingScreenData,
  options: LoadingScreenOptions = {},
): Promise<string> {
  await preloadLoadingScreenImages(data, options);

  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];
  const isArena = data.layout === "arena";
  const width = isArena ? ARENA_WIDTH : STANDARD_WIDTH;
  const height = isArena ? ARENA_HEIGHT : STANDARD_HEIGHT;

  const svg = await satori(<LoadingScreen data={data} />, {
    width,
    height,
    fonts,
  });
  return svg;
}

export async function loadingScreenToImage(
  data: LoadingScreenData,
  options: LoadingScreenOptions = {},
): Promise<Uint8Array> {
  const svg = await loadingScreenToSvg(data, options);
  const png = await svgToPng(svg);
  return png;
}
