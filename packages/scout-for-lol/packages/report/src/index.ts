/* eslint-disable custom-rules/no-re-exports -- report package is a library, so re-exports are intentional */
export { matchToImage, matchToSvg, svgToPng } from "./html/index.tsx";
export { Report } from "./html/report.tsx";
export { toMatch } from "./match.ts";
export { arenaMatchToImage, arenaMatchToSvg } from "./html/arena/index.tsx";
export {
  getChampionInfo,
  extractRunes,
  participantToChampion,
} from "@scout-for-lol/data";
