import satori from "satori";
import { type ArenaMatch } from "@scout-for-lol/data";
import { ArenaReport } from "@scout-for-lol/report/html/arena/report.tsx";
import {
  bunBeaufortFonts,
  bunSpiegelFonts,
} from "@scout-for-lol/report/assets/index.ts";
import { svgToPng } from "@scout-for-lol/report/html/index.tsx";
import {
  preloadChampionImages,
  preloadAugmentIcons,
} from "@scout-for-lol/report/dataDragon/image-cache.ts";

export async function arenaMatchToSvg(match: ArenaMatch) {
  // Collect all champion names that need pre-loading
  const championNames: string[] = [];
  for (const team of match.teams) {
    for (const player of team.players) {
      championNames.push(player.championName);
    }
  }

  // Collect all augment icon paths that need pre-loading
  const augmentIconPaths: string[] = [];
  for (const team of match.teams) {
    for (const player of team.players) {
      for (const augment of player.augments) {
        if (augment.type === "full" && augment.iconLarge) {
          augmentIconPaths.push(augment.iconLarge);
        }
      }
    }
  }

  // Pre-load all images before rendering (items and spells are pre-loaded at module level)
  await Promise.all([
    preloadChampionImages(championNames),
    preloadAugmentIcons(augmentIconPaths),
  ]);

  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];
  const svg = await satori(<ArenaReport match={match} />, {
    width: 1600,
    height: 6000,
    fonts,
  });
  return svg;
}

export async function arenaMatchToImage(match: ArenaMatch) {
  const svg = await arenaMatchToSvg(match);
  const png = await svgToPng(svg);
  return png;
}
