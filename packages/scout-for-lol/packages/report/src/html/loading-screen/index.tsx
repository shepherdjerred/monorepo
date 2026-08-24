import satori from "satori";
import type { LoadingScreenData } from "@scout-for-lol/data";
import { LoadingScreen } from "#src/html/loading-screen/loading-screen.tsx";
import {
  bunCjkFonts,
  bunReportFonts,
  containsCjkText,
} from "@scout-for-lol/design-system/satori/fonts";
import { bunClassicFonts } from "@scout-for-lol/design-system/satori/classic-fonts";
import { ClassicLoadingScreen } from "#src/html/loading-screen/classic-layout.tsx";
import { getClassicBackgroundBase64 } from "@scout-for-lol/data";
import {
  preloadChampionLoadingImages,
  preloadChampionImages,
} from "#src/dataDragon/image-cache.ts";
import { svgToPng } from "#src/html/index.tsx";

// Standard/ARAM: one row of cards per side + header/bans. The width is derived
// from the larger side so a tournament-code custom (teamSize 1-5) is not
// rendered onto a canvas sized for ten players, which would leave most of the
// image empty. PlayerCard's standard variant is 280 wide with an 8px gap, and
// 5 * 280 + 4 * 8 + 168 = 1600 — so a full 5v5 reproduces the previous constant
// exactly and every committed baseline is unchanged.
const STANDARD_CARD_WIDTH = 280;
const STANDARD_CARD_GAP = 8;
const STANDARD_HORIZONTAL_PADDING = 168;
const STANDARD_FULL_SIDE = 5;
// A 1v1 would otherwise be 448 wide, too narrow for the header and ban row.
// Same floor the arena layout uses.
const STANDARD_MIN_WIDTH = 640;
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

function getStandardCanvasDimensions(
  data: LoadingScreenData,
): CanvasDimensions {
  const sideSize = (team: "blue" | "red") =>
    data.participants.filter((participant) => participant.team === team).length;
  const largestSide = Math.max(sideSize("blue"), sideSize("red"));
  const columns = Math.min(STANDARD_FULL_SIDE, Math.max(1, largestSide));

  const width = rowWidth({
    columns,
    cardWidth: STANDARD_CARD_WIDTH,
    gap: STANDARD_CARD_GAP,
    padding: STANDARD_HORIZONTAL_PADDING,
  });

  return {
    width: Math.max(STANDARD_MIN_WIDTH, width),
    height: STANDARD_HEIGHT,
  };
}

export function getLoadingScreenCanvasDimensions(
  data: LoadingScreenData,
): CanvasDimensions {
  if (data.layout === "classic") {
    return { width: 1920, height: 1280 };
  }
  if (data.layout === "arena") {
    return getArenaCanvasDimensions(data);
  }

  return getStandardCanvasDimensions(data);
}

async function preloadLoadingScreenImages(
  data: LoadingScreenData,
): Promise<void> {
  const participantsToRender =
    data.layout === "arena"
      ? data.participants.filter((participant) => participant.isTrackedPlayer)
      : data.participants;

  // Preload champion loading screen art (base skin) for rendered participants.
  await preloadChampionLoadingImages(
    participantsToRender.map((p) => p.championName),
  );

  // Preload small champion square portraits for bans
  if (data.layout !== "classic" && data.bans.length > 0) {
    const banChampionNames = data.bans.map((b) => b.championName);
    await preloadChampionImages(banChampionNames);
  }
}

export async function loadingScreenToSvg(
  data: LoadingScreenData,
): Promise<string> {
  await preloadLoadingScreenImages(data);

  const { width, height } = getLoadingScreenCanvasDimensions(data);
  if (data.layout === "classic") {
    const [fonts, background] = await Promise.all([
      bunClassicFonts(),
      getClassicBackgroundBase64(),
    ]);
    const cjkFonts = containsCjkText(data) ? await bunCjkFonts(data) : [];
    return satori(
      <ClassicLoadingScreen data={data} background={background} />,
      {
        width,
        height,
        fonts: [...fonts, ...cjkFonts],
      },
    );
  }

  const fonts = await bunReportFonts(containsCjkText(data), data);
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
  const png = await svgToPng(
    svg,
    data.layout === "classic" ? { crop: false } : {},
  );
  return png;
}
