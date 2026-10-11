export { matchToSvg, svgToPng } from "./html/index.tsx";
export { fnv1a } from "./html/shared/pick-design.ts";
export {
  competitionChartToImage,
  type CompetitionChartProps,
  type CompetitionChartSeries,
  type CompetitionChartBar,
} from "./html/charts/competition-chart.ts";
export {
  analyticsChartToImage,
  type AnalyticsChartProps,
} from "./html/charts/analytics-chart.ts";
export { visualizationSnapshotToImage } from "./html/snapshot/visualization-snapshot-image.ts";
export { discordScreenshotToImage } from "./html/discord-screenshot.tsx";
export { arenaMatchToSvg } from "./html/arena/index.tsx";
export {
  classicMatchToImage,
  classicMatchToSvg,
} from "./html/classic/index.tsx";
export {
  loadingScreenToSvg,
  loadingScreenToImage,
} from "./html/loading-screen/index.tsx";
export { setItemMissHandler } from "./dataDragon/image-cache.ts";
// The one place a snapshot series' value is turned into text. Discord's native
// embed path renders the same snapshots as the chart images do, so it reads
// display kinds through these rather than keeping a second opinion.
export {
  formatSeriesValue,
  formatSeriesAbsoluteDelta,
  isPercentageSeries,
} from "./html/visualization-value-format.ts";
