export { matchToImage, matchToSvg, svgToPng } from "./html/index.tsx";
export { fnv1a } from "./html/shared/pick-design.ts";
export {
  competitionChartToImage,
  competitionChartToSvg,
  type CompetitionChartProps,
  type CompetitionChartSeries,
  type CompetitionChartBar,
} from "./html/competition-chart.ts";
export {
  analyticsChartToImage,
  analyticsChartToSvg,
  type AnalyticsChartProps,
  type AnalyticsChartSeries,
} from "./html/analytics-chart.ts";
export {
  visualizationSnapshotToImage,
  visualizationSnapshotToSvg,
} from "./html/visualization-snapshot-image.ts";
export { visualizationSnapshotToOption } from "./html/visualization-snapshot-option.ts";
export {
  discordScreenshotToImage,
  discordScreenshotToSvg,
  type DiscordChatMessage,
  type DiscordScreenshotOptions,
} from "./html/discord-screenshot.tsx";
export { Report } from "./html/report.tsx";
export { toMatch } from "./match.ts";
export { arenaMatchToImage, arenaMatchToSvg } from "./html/arena/index.tsx";
export {
  classicMatchToImage,
  classicMatchToSvg,
} from "./html/classic/index.tsx";
export {
  loadingScreenToSvg,
  loadingScreenToImage,
} from "./html/loading-screen/index.tsx";
export {
  setItemMissHandler,
  type ItemMissEvent,
} from "./dataDragon/image-cache.ts";
// The one place a snapshot series' value is turned into text. Discord's native
// embed path renders the same snapshots as the chart images do, so it reads
// display kinds through these rather than keeping a second opinion.
export {
  formatSeriesValue,
  formatSeriesAbsoluteDelta,
} from "./html/visualization-value-format.ts";
export {
  getChampionInfo,
  extractRunes,
  participantToChampion,
} from "@scout-for-lol/data";
