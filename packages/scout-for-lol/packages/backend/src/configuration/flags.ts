/**
 * Feature Flags and Limits System
 *
 * Centralized, type-safe configuration for integer limits and boolean flags
 * with hierarchical override support.
 *
 * Design principles:
 * - Type-safe: String literal types for flag/limit names with compile-time checking
 * - Hierarchical overrides: Most-specific match wins
 * - Extensible attributes: Support server, user, player, and custom dimensions
 * - Code-based storage: All configs defined in TypeScript
 * - Explicit defaults: Every limit returns a number (large values for "unlimited")
 */

import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

// ============================================================================
// Attribute Types
// ============================================================================

/**
 * Attributes that can be used for limit/flag lookups
 */
export type FlagAttributes = {
  server?: DiscordGuildId;
  user?: DiscordAccountId;
  player?: number;
  [key: string]: string | number | undefined;
};

// ============================================================================
// Limit Registry
// ============================================================================

/**
 * Override definition for limits
 */
type LimitOverride = {
  value: number | "unlimited";
  attributes: FlagAttributes;
};

/**
 * Limit configuration
 */
type LimitConfig = {
  default: number;
  overrides: LimitOverride[];
};

export type LimitName =
  | "player_subscriptions"
  | "accounts"
  | "competitions_per_owner"
  | "competitions_per_server";

const ME = DiscordAccountIdSchema.parse("160509172704739328");
export const MY_SERVER = DiscordGuildIdSchema.parse("1337623164146155593");

/**
 * Central registry for all integer limits
 */
const LIMIT_REGISTRY: Record<LimitName, LimitConfig> = {
  player_subscriptions: {
    default: 75,
    overrides: [{ value: "unlimited", attributes: { server: MY_SERVER } }],
  },
  accounts: {
    default: 50,
    overrides: [{ value: "unlimited", attributes: { server: MY_SERVER } }],
  },
  competitions_per_owner: {
    default: 1,
    overrides: [
      {
        value: "unlimited",
        attributes: { user: ME },
      },
    ],
  },
  competitions_per_server: {
    default: 2,
    overrides: [
      {
        value: "unlimited",
        attributes: { user: ME },
      },
    ],
  },
};

// ============================================================================
// Flag Registry
// ============================================================================

/**
 * Override definition for flags
 */
type FlagOverride = {
  value: boolean;
  attributes: FlagAttributes;
};

/**
 * Flag configuration
 */
type FlagConfig = {
  default: boolean;
  overrides: FlagOverride[];
};

export type FlagName =
  | "ai_reviews_enabled"
  | "common_denominator_enabled"
  | "debug";

/**
 * Central registry for all boolean flags
 */
const FLAG_REGISTRY: Record<FlagName, FlagConfig> = {
  ai_reviews_enabled: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { server: MY_SERVER },
      },
    ],
  },
  common_denominator_enabled: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { server: MY_SERVER },
      },
    ],
  },
  debug: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { user: ME },
      },
    ],
  },
};

// ============================================================================
// Matching Algorithm
// ============================================================================

/**
 * Calculate specificity score for an attribute match
 *
 * More specific matches (more attributes) get higher scores
 */
function calculateSpecificity(attributes: FlagAttributes): number {
  return Object.keys(attributes).filter((key) => attributes[key] !== undefined)
    .length;
}

/**
 * Check if override attributes match the query attributes
 */
function attributesMatch(
  overrideAttrs: FlagAttributes,
  queryAttrs: FlagAttributes,
): boolean {
  // All override attributes must match corresponding query attributes
  for (const [key, value] of Object.entries(overrideAttrs)) {
    if (value === undefined) {
      continue;
    }
    if (queryAttrs[key] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Find the most specific matching override
 *
 * Algorithm: Match all overrides, then return the one with highest specificity
 * Specificity = number of attributes matched
 */
function findBestMatch<T>(
  overrides: { value: T; attributes: FlagAttributes }[],
  queryAttrs: FlagAttributes,
): T | undefined {
  let bestMatch: { value: T; specificity: number } | undefined;

  for (const override of overrides) {
    if (attributesMatch(override.attributes, queryAttrs)) {
      const specificity = calculateSpecificity(override.attributes);

      if (!bestMatch || specificity > bestMatch.specificity) {
        bestMatch = { value: override.value, specificity };
      }
    }
  }

  return bestMatch?.value;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get an integer limit value
 *
 * Checks for overrides matching the provided attributes, falling back to default.
 * Returns the most specific matching override.
 *
 * @param name - Limit name (type-checked against registry)
 * @param attributes - Attributes to match (server, user, player, etc.)
 * @returns Limit value (number or "unlimited")
 *
 * @example
 * ```typescript
 * const limit = getLimit("player_subscriptions", { server: serverId });
 * if (count >= limit) {
 *   // Handle limit reached
 * }
 * ```
 */
export function getLimit(
  name: LimitName,
  attributes: FlagAttributes = {},
): number | "unlimited" {
  const config = LIMIT_REGISTRY[name];
  const override = findBestMatch(config.overrides, attributes);
  const value = override ?? config.default;
  return value;
}

/**
 * Get a boolean flag value
 *
 * Checks for overrides matching the provided attributes, falling back to default.
 * Returns the most specific matching override.
 *
 * @param name - Flag name (type-checked against registry)
 * @param attributes - Attributes to match (server, user, player, etc.)
 * @returns Flag value (boolean)
 *
 * @example
 * ```typescript
 * const enabled = getFlag("ai_reviews_enabled", { server: serverId });
 * if (enabled) {
 *   // Generate AI review
 * }
 * ```
 */
export function getFlag(
  name: FlagName,
  attributes: FlagAttributes = {},
): boolean {
  const config = FLAG_REGISTRY[name];
  const override: boolean | undefined = findBestMatch(
    config.overrides,
    attributes,
  );
  return override ?? config.default;
}

/**
 * Add a limit override at runtime
 *
 * Useful for dynamic overrides
 */
export function addLimitOverride(
  name: LimitName,
  value: number | "unlimited",
  attributes: FlagAttributes,
): void {
  const config = LIMIT_REGISTRY[name];
  config.overrides.push({ value, attributes });
}

/**
 * Add a flag override at runtime
 *
 * Useful for dynamic overrides like enabling features for specific servers
 */
export function addFlagOverride(
  name: FlagName,
  value: boolean,
  attributes: FlagAttributes,
): void {
  const config = FLAG_REGISTRY[name];
  config.overrides.push({ value, attributes });
}

/**
 * Clear all overrides for a limit (useful for testing)
 */
export function clearLimitOverrides(name: LimitName): void {
  const config = LIMIT_REGISTRY[name];
  config.overrides.length = 0;
}

/**
 * Clear all overrides for a flag (useful for testing)
 */
export function clearFlagOverrides(name: FlagName): void {
  const config = FLAG_REGISTRY[name];
  config.overrides.length = 0;
}
