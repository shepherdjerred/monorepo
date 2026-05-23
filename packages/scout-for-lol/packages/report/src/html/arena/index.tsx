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
import {
  ARENA_DEFAULT_SKIN_NUM,
  getArenaTeamCardWidth,
} from "#src/html/arena/utils.ts";

const BASE_HEIGHT = 1090;
const PAGE_PADDING = 48;
const TEAM_GAP = 32;
const MAX_WIDTH = 2400;

function getTrackedTeams(match: ArenaMatch) {
  const trackedNames = new Set(
    match.players.map((p) => p.champion.riotIdGameName),
  );
  return match.teams.filter((team) =>
    team.players.some((p) => trackedNames.has(p.riotIdGameName)),
  );
}

function getCanvasDimensions(match: ArenaMatch): {
  width: number;
  height: number;
} {
  const trackedTeams = getTrackedTeams(match);
  const cardWidths =
    trackedTeams.length === 0
      ? [getArenaTeamCardWidth(1)]
      : trackedTeams.map((team) => getArenaTeamCardWidth(team.players.length));
  const teamGaps = Math.max(0, cardWidths.length - 1) * TEAM_GAP;
  const contentWidth = cardWidths.reduce((sum, width) => sum + width, 0);
  const width = Math.min(MAX_WIDTH, PAGE_PADDING * 2 + teamGaps + contentWidth);
  return { width, height: BASE_HEIGHT };
}

export async function arenaMatchToSvg(match: ArenaMatch) {
  const trackedTeams = getTrackedTeams(match);

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
  const png = await svgToPng(svg, { crop: false });
  return png;
}
