// Browser-safe exports - only the Report component
// No satori, no resvg, no server-side code
export { Report } from "./html/report.tsx";
export { visualizationSnapshotToOption } from "./html/visualization-snapshot-option.ts";
export type { VisualizationOptionMode } from "./html/visualization-snapshot-option.ts";
export type { VisualizationSnapshot } from "@scout-for-lol/data";
export type { ArenaMatch, CompletedMatch } from "@scout-for-lol/data";
