import satori from "satori";
import type { LoadingScreenData } from "@scout-for-lol/data";
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

async function preloadLoadingScreenImages(
  data: LoadingScreenData,
): Promise<void> {
  // Preload champion loading screen art for all participants
  const loadingImageEntries = data.participants.map((p) => ({
    championName: p.championName,
    skinNum: p.skinNum,
  }));
  await preloadChampionLoadingImages(loadingImageEntries);

  // Preload small champion square portraits for bans
  if (data.bans.length > 0) {
    const banChampionNames = data.bans.map((b) => b.championName);
    await preloadChampionImages(banChampionNames);
  }
}

export async function loadingScreenToSvg(
  data: LoadingScreenData,
): Promise<string> {
  await preloadLoadingScreenImages(data);

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
): Promise<Uint8Array> {
  const svg = await loadingScreenToSvg(data);
  const png = await svgToPng(svg);
  return png;
}
