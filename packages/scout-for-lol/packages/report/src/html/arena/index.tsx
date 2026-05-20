import satori from "satori";
import { type ArenaMatch } from "@scout-for-lol/data";
import { ArenaReport } from "#src/html/arena/report.tsx";
import { bunBeaufortFonts, bunSpiegelFonts } from "#src/assets/index.ts";
import { svgToPng } from "#src/html/index.tsx";
import {
  preloadChampionImages,
  preloadChampionLoadingImages,
  preloadAugmentIcons,
} from "#src/dataDragon/image-cache.ts";
import { ARENA_DEFAULT_SKIN_NUM } from "#src/html/arena/utils.ts";

// Tracked teams render side-by-side; height stays constant, width grows with
// the number of tracked teams so each column gets ~600px to breathe.
const BASE_HEIGHT = 1100;
const WIDTH_PER_TRACKED_TEAM = 600;
const MIN_WIDTH = 1200;
const MAX_WIDTH = 2400;

function countTrackedTeams(match: ArenaMatch): number {
  const trackedNames = new Set(
    match.players.map((p) => p.champion.riotIdGameName),
  );
  return match.teams.filter((team) =>
    team.players.some((p) => trackedNames.has(p.riotIdGameName)),
  ).length;
}

function getCanvasDimensions(match: ArenaMatch): {
  width: number;
  height: number;
} {
  const trackedTeams = Math.max(1, countTrackedTeams(match));
  const width = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, trackedTeams * WIDTH_PER_TRACKED_TEAM + 96),
  );
  return { width, height: BASE_HEIGHT };
}

export async function arenaMatchToSvg(match: ArenaMatch) {
  const trackedNames = new Set(
    match.players.map((p) => p.champion.riotIdGameName),
  );
  const trackedTeams = match.teams.filter((team) =>
    team.players.some((p) => trackedNames.has(p.riotIdGameName)),
  );

  const loadingImageEntries: { championName: string; skinNum: number }[] = [];
  const championNames: string[] = [];
  const augmentIconPaths: string[] = [];

  for (const team of trackedTeams) {
    for (const player of team.players) {
      loadingImageEntries.push({
        championName: player.championName,
        skinNum: ARENA_DEFAULT_SKIN_NUM,
      });
      championNames.push(player.championName);
      for (const augment of player.augments) {
        if (augment.type === "full" && augment.iconLarge) {
          augmentIconPaths.push(augment.iconLarge);
        }
      }
    }
  }

  await Promise.all([
    preloadChampionImages(championNames),
    preloadChampionLoadingImages(loadingImageEntries),
    preloadAugmentIcons(augmentIconPaths),
  ]);

  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];
  const { width, height } = getCanvasDimensions(match);
  const svg = await satori(<ArenaReport match={match} />, {
    width,
    height,
    fonts,
  });
  return svg;
}

export async function arenaMatchToImage(match: ArenaMatch) {
  const svg = await arenaMatchToSvg(match);
  const png = await svgToPng(svg);
  return png;
}
