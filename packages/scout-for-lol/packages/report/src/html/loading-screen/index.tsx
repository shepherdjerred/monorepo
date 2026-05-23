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
// Arena prematch only renders tracked player champions; Riot does not expose
// reliable subteams in current 3v3 spectator payloads.
const ARENA_MIN_WIDTH = 640;
const ARENA_STANDARD_HEIGHT = 720;
const ARENA_COMPACT_BASE_HEIGHT = 600;
const ARENA_CARD_GAP = 18;
const ARENA_HORIZONTAL_PADDING = 64;
const ARENA_COMPACT_MAX_COLUMNS = 6;
const ARENA_STANDARD_CARD_WIDTH = 280;
const ARENA_COMPACT_CARD_WIDTH = 210;
const ARENA_COMPACT_CARD_HEIGHT = 360;

type CanvasDimensions = {
  width: number;
  height: number;
};

function getArenaTrackedParticipantCount(data: LoadingScreenData): number {
  if (data.layout !== "arena") {
    return 0;
  }
  return data.participants.filter((participant) => participant.isTrackedPlayer)
    .length;
}

function rowWidth(params: {
  columns: number;
  cardWidth: number;
  gap: number;
  padding: number;
}): number {
  const gaps = Math.max(0, params.columns - 1) * params.gap;
  return params.columns * params.cardWidth + gaps + params.padding;
}

function getArenaCanvasDimensions(data: LoadingScreenData): CanvasDimensions {
  const trackedCount = getArenaTrackedParticipantCount(data);
  if (trackedCount <= 1) {
    return { width: ARENA_MIN_WIDTH, height: ARENA_STANDARD_HEIGHT };
  }

  if (trackedCount <= 3) {
    const width = rowWidth({
      columns: trackedCount,
      cardWidth: ARENA_STANDARD_CARD_WIDTH,
      gap: ARENA_CARD_GAP,
      padding: ARENA_HORIZONTAL_PADDING,
    });
    return {
      width: Math.max(ARENA_MIN_WIDTH, width),
      height: ARENA_STANDARD_HEIGHT,
    };
  }

  const columns = Math.min(trackedCount, ARENA_COMPACT_MAX_COLUMNS);
  const rows = Math.ceil(trackedCount / ARENA_COMPACT_MAX_COLUMNS);
  const width = rowWidth({
    columns,
    cardWidth: ARENA_COMPACT_CARD_WIDTH,
    gap: ARENA_CARD_GAP,
    padding: ARENA_HORIZONTAL_PADDING,
  });
  const height =
    ARENA_COMPACT_BASE_HEIGHT +
    Math.max(0, rows - 1) * (ARENA_COMPACT_CARD_HEIGHT + ARENA_CARD_GAP);

  return {
    width: Math.max(ARENA_MIN_WIDTH, width),
    height,
  };
}

export function getLoadingScreenCanvasDimensions(
  data: LoadingScreenData,
): CanvasDimensions {
  if (data.layout === "arena") {
    return getArenaCanvasDimensions(data);
  }

  return { width: STANDARD_WIDTH, height: STANDARD_HEIGHT };
}

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
  const participantsToRender =
    data.layout === "arena"
      ? data.participants.filter((participant) => participant.isTrackedPlayer)
      : data.participants;

  // Preload champion loading screen art for rendered participants.
  const loadingImageEntries = participantsToRender.map((p) => ({
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
  const { width, height } = getLoadingScreenCanvasDimensions(data);

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
