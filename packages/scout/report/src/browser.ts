/* eslint-disable custom-rules/no-re-exports -- report package is a library, so re-exports are intentional */
// Browser-safe exports - only the Report component
// No satori, no resvg, no server-side code
export { Report } from "./html/report.tsx";
export type { ArenaMatch, CompletedMatch } from "@shepherdjerred/scout-data";
