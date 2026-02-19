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
 * Import directly from submodules:
 * - ./types.ts - Core types (ChartInfo, JSONSchemaProperty, TypeScriptInterface, TypeProperty)
 * - ./schemas.ts - Zod schemas (HelmValueSchema, StringSchema, etc.)
 * - ./config.ts - Configuration (EXTENSIBLE_TYPE_PATTERNS, shouldAllowArbitraryProps)
 * - ./chart-info-parser.ts - Chart info parsing (parseChartInfoFromVersions)
 * - ./yaml-comments.ts - YAML comments (cleanYAMLComment, parseYAMLComments)
 * - ./chart-fetcher.ts - Chart fetching (fetchHelmChart)
 * - ./type-converter.ts - Type conversion (jsonSchemaToTypeScript, inferTypeFromValue, etc.)
 * - ./interface-generator.ts - Code generation (generateTypeScriptCode)
 * - ./utils.ts - Utilities (sanitizePropertyName, sanitizeTypeName, capitalizeFirst)
 */

/** Version marker for the helm-types package. */
export const HELM_TYPES_PACKAGE_VERSION = "1.1.0";
