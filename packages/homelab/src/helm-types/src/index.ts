/**
 * @homelab/helm-types
 *
 * A library for generating TypeScript types from Helm chart values.
 *
 * Core functionality:
 * - Fetch Helm charts from repositories
 * - Parse values.yaml and values.schema.json
 * - Generate TypeScript interfaces with JSDoc comments
 * - Support for nested objects, arrays, and unions
 *
 * This is a general-purpose library that can be used with any Helm chart.
 * Application-specific logic should be kept in your application code.
 *
 * The root export is the complete supported public API.
 */
export { fetchHelmChart } from "./chart-fetcher.js";
export type { FetchedHelmChart } from "./chart-fetcher.js";
export { parseChartInfoFromVersions } from "./chart-info-parser.js";
export { generateTypeScriptCode } from "./interface-generator.js";
export {
  convertToTypeScriptInterface,
  inferTypeFromValue,
  jsonSchemaToTypeScript,
} from "./type-converter.js";
export type {
  ChartInfo,
  JSONSchemaProperty,
  TypeProperty,
  TypeScriptInterface,
} from "./types.js";
export { HelmValueSchema } from "./schemas.js";
export type { HelmValue } from "./schemas.js";
