// Main entry point for Helm type generation
// This file re-exports all functionality from the modular components

// Core types
export type { ChartInfo, JSONSchemaProperty, TypeScriptInterface, TypeProperty } from "./types.js";

// Schemas
export type { HelmValue } from "./schemas.js";
export {
  StringSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
  NullSchema,
  UndefinedSchema,
  ArraySchema,
  RecordSchema,
  ErrorSchema,
  StringBooleanSchema,
  HelmValueSchema,
} from "./schemas.js";

// Configuration
export { EXTENSIBLE_TYPE_PATTERNS, shouldAllowArbitraryProps } from "./config.js";

// Chart info parsing
export { parseChartInfoFromVersions } from "./chart-info-parser.js";

// YAML comments
export { cleanYAMLComment, parseYAMLComments } from "./yaml-comments.js";

// Chart fetching
export { fetchHelmChart } from "./chart-fetcher.js";

// Type conversion
export {
  jsonSchemaToTypeScript,
  inferTypeFromValue,
  typesAreCompatible,
  convertToTypeScriptInterface,
} from "./type-converter.js";

// Code generation
export { generateTypeScriptCode } from "./interface-generator.js";

// Utilities
export { sanitizePropertyName, sanitizeTypeName, capitalizeFirst } from "./utils.js";
