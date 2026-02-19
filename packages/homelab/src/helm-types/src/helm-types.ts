/**
 * This file previously served as a barrel/re-export module.
 * Import directly from submodules instead:
 * - ./types.ts - Core types
 * - ./schemas.ts - Zod schemas
 * - ./config.ts - Configuration
 * - ./chart-info-parser.ts - Chart info parsing
 * - ./yaml-comments.ts - YAML comments
 * - ./chart-fetcher.ts - Chart fetching
 * - ./type-converter.ts - Type conversion
 * - ./interface-generator.ts - Code generation
 * - ./utils.ts - Utilities
 */

/** Version marker for the helm-types module. */
export const HELM_TYPES_VERSION = "1.1.0";
