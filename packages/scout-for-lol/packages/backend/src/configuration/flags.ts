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
import { isEnabled } from "@shepherdjerred/feature-flags";
import { isAbsent } from "@shepherdjerred/feature-flags/flag-result.ts";
import { resolveEnvironment } from "#src/configuration.ts";

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
  | "competitions_per_server"
  | "reports_per_owner_per_server"
  | "reports_per_server";

const ME = DiscordAccountIdSchema.parse("160509172704739328");
export { ME };
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
  reports_per_owner_per_server: {
    default: 2,
    overrides: [
      {
        value: "unlimited",
        attributes: { user: ME },
      },
    ],
  },
  reports_per_server: {
    default: 3,
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
  | "ai_reports_enabled"
  | "ai_reports_unlimited"
  | "ai_reviews_enabled"
  | "betting_enabled"
  | "bucks_dares_enabled"
  | "dare_v2"
  | "dare_extended_contracts_enabled"
  | "dare_notifications_enabled"
  | "bucks_transfers_enabled"
  | "weekly_parlays_enabled"
  | "betting_player_bet_outcome_dm_enabled"
  | "betting_settlement_dm_enabled"
  | "competition_builder_v2_enabled"
  | "challenge_runs_enabled"
  | "custom_nights_enabled"
  | "debug"
  | "duels_enabled"
  | "explore_creation_enabled"
  | "hall_of_fame_enabled"
  | "initial_match_history_import_enabled"
  | "scoutql_relational_enabled"
  | "scout-consumer-player-profiles-enabled"
  | "tournament_lobbies_enabled";

/** Flipt is authoritative when available. The registry remains a fail-closed
 * compatibility seed and test fixture for provider-unavailable evaluations. */
export type PolicyFlagName = FlagName;

/**
 * Beta-only product surfaces that are permanently excluded from production.
 * This policy sits above both the local registry and Flipt so an operator
 * override cannot accidentally expose a forbidden production surface.
 */
const PRODUCTION_HARD_DISABLED_FLAGS: ReadonlySet<FlagName> = new Set<FlagName>(
  [
    "ai_reports_enabled",
    "ai_reports_unlimited",
    "ai_reviews_enabled",
    "betting_enabled",
    "bucks_dares_enabled",
    "dare_v2",
    "dare_extended_contracts_enabled",
    "dare_notifications_enabled",
    "bucks_transfers_enabled",
    "weekly_parlays_enabled",
    "betting_player_bet_outcome_dm_enabled",
    "betting_settlement_dm_enabled",
    "challenge_runs_enabled",
    "competition_builder_v2_enabled",
    "custom_nights_enabled",
    "duels_enabled",
    "hall_of_fame_enabled",
    "tournament_lobbies_enabled",
    "scoutql_relational_enabled",
  ],
);

export function isFeatureHardDisabled(name: FlagName): boolean {
  return (
    resolveEnvironment() === "prod" && PRODUCTION_HARD_DISABLED_FLAGS.has(name)
  );
}

/**
 * Central registry for all boolean flags
 */
const FLAG_REGISTRY: Record<FlagName, FlagConfig> = {
  hall_of_fame_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  challenge_runs_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  // Direct duels and structured events stay disabled in beta and production
  // until Riot's written approval for classic objective rules and sub-20
  // events is recorded. Pure domain behavior remains available to dev/stub
  // tests while this rollout flag has no enabled compatibility override.
  duels_enabled: {
    default: false,
    overrides: [],
  },
  custom_nights_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  competition_builder_v2_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  ai_reports_enabled: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { server: MY_SERVER },
      },
    ],
  },
  ai_reports_unlimited: {
    default: false,
    overrides: [{ value: true, attributes: { user: ME } }],
  },
  /**
   * Tournament-code custom lobbies (`/lobby`).
   *
   * The local override enables the beta test guild. This is permanently
   * beta-only: production's hard-disable policy wins before this registry or
   * Flipt is evaluated.
   */
  tournament_lobbies_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  ai_reviews_enabled: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { server: MY_SERVER },
      },
    ],
  },
  // Bryan Bucks. Gates the whole betting economy: pool creation, bet placement,
  // settlement announcements, AND earning. Earning is gated deliberately — an
  // ungated economy would accrue silently in every server, and enabling the
  // flag later would hand out a surprise backlog. The trade is that enabling it
  // starts a guild at zero with no backfill.
  //
  // This is a private, single-server beta experiment and is not intended to
  // become a Scout-wide feature. Production's hard-disable policy wins before
  // this registry or Flipt is evaluated.
  betting_enabled: {
    default: false,
    overrides: [
      {
        value: true,
        attributes: { server: MY_SERVER },
      },
    ],
  },
  // Free-text Bryan Bucks dare bounties. Gates creating a dare, contributing
  // to a pot, and accepting only; chicken-out (decline), refunds, sweeps, and
  // settlement stay ungated so escrowed contributions can always be resolved
  // after a revocation. Narrower than the betting economy itself, so the
  // domain requires both flags. Production's hard-disable policy wins before
  // this registry or Flipt is evaluated.
  bucks_dares_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  // ScoutQL-backed Dare v2 creation. Settlement and refunds never consult
  // this flag; revoking it only stops new drafts from being funded.
  dare_v2: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  dare_extended_contracts_enabled: {
    default: false,
    overrides: [],
  },
  dare_notifications_enabled: {
    default: false,
    overrides: [],
  },
  // Relational/timeline ScoutQL access is an independently ramped capability
  // because it exposes a wider query surface than Dare v2 creation itself.
  scoutql_relational_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  // Fee-bearing Bryan Bucks wallet transfers. This is narrower than the
  // betting economy itself, so the domain requires both flags. Production's
  // hard-disable policy remains authoritative over local and Flipt values.
  bucks_transfers_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  // Week-spanning Bryan Bucks markets remain a narrower private-beta rollout
  // than the betting economy itself. New positions require both flags;
  // settlement and refunds deliberately do not.
  weekly_parlays_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  // Settlement messages are a separate rollout from the betting economy: the
  // economy must keep paying or refunding open positions even while Discord
  // delivery is disabled. The player-facing notice depends on the bettor
  // receipt flag so a bettor who is also playing still has exactly one result.
  betting_settlement_dm_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
  },
  betting_player_bet_outcome_dm_enabled: {
    default: false,
    overrides: [{ value: true, attributes: { server: MY_SERVER } }],
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
  /**
   * Confirming an Explore-prepared report, subscription or competition.
   *
   * One flag covers all three kinds: which entities a given person may create
   * is already decided by per-entity RBAC at confirm time, so a per-kind flag
   * would only duplicate that. Deliberately absent from
   * `PRODUCTION_HARD_DISABLED_FLAGS` — this is meant to ramp through Flipt
   * rather than stay beta-only. It is re-read at confirm time, so revoking it
   * blocks intents that were already prepared.
   */
  explore_creation_enabled: {
    default: false,
    overrides: [],
  },
  initial_match_history_import_enabled: {
    default: false,
    overrides: [],
  },
  "scout-consumer-player-profiles-enabled": {
    default: false,
    overrides: [],
  },
};

/**
 * The overrides each flag was declared with, captured at module load.
 *
 * `FLAG_REGISTRY` is mutable module state shared by every test file in a Bun
 * process, so a test that calls `clearFlagOverrides` and stops there leaves the
 * flag switched off for everything that runs afterwards — a failure that
 * depends on file order and reads as a bug in unrelated code. `resetFlagOverrides`
 * gives a test a way to put the world back without hard-coding what the
 * defaults were.
 */
const INITIAL_FLAG_OVERRIDES = new Map<string, FlagOverride[]>(
  Object.entries(FLAG_REGISTRY).map(([name, config]) => [
    name,
    config.overrides.map((override) => ({ ...override })),
  ]),
);

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
  if (isFeatureHardDisabled(name)) {
    return false;
  }
  const config = FLAG_REGISTRY[name];
  const override: boolean | undefined = findBestMatch(
    config.overrides,
    attributes,
  );
  return override ?? config.default;
}

export async function isPolicyEnabled(
  name: PolicyFlagName,
  attributes: FlagAttributes = {},
): Promise<boolean> {
  if (isFeatureHardDisabled(name)) {
    return false;
  }
  const fallback = getFlag(name, attributes);
  const targetingKey = attributes.user ?? attributes.server ?? "scout-backend";
  const context: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) context[key] = value;
  }
  const result = await isEnabled(name, {
    default: fallback,
    targetingKey,
    attributes: context,
  });
  if (result.errorCode !== undefined && !isAbsent(result)) {
    throw new Error(
      `Feature flag "${name}" evaluation failed with ${result.errorCode}`,
    );
  }
  return result.value;
}

/**
 * Every guild a flag is switched on for, whole-guild.
 *
 * Used to decide where a guild-scoped slash command should be registered, so
 * the flag registry stays the single source of truth for "who has this?" — add
 * a second guild override and the command follows automatically.
 *
 * Only counts overrides whose *sole* attribute is `server`. A more specific
 * override such as `{ server, user }` enables the flag for one person in that
 * guild, which is not the same as the guild having the feature, and registering
 * a command for everyone there on that basis would be wrong.
 *
 * @throws if the flag defaults to true, where "which guilds" has no answer —
 * such a flag belongs on a global command, and silently returning an empty list
 * would unregister it everywhere.
 */
export function listGuildsWithFlagEnabled(name: FlagName): DiscordGuildId[] {
  return listWholeGuildOverrides(name, (value) => value);
}

/**
 * Every guild a flag carries a whole-guild override for, in **either**
 * direction.
 *
 * The superset of `listGuildsWithFlagEnabled`, and the reconciliation set for
 * guild-scoped command registration: registering is a PUT that *replaces* a
 * guild's command list, so a guild whose flag was switched off has to be
 * visited with an empty payload or Discord keeps serving the command forever.
 * Only the enabled list can say where a command belongs; only this one can say
 * where it no longer does.
 *
 * The consequence is a contract on how a guild-scoped feature is withdrawn:
 * flip its override to `value: false` rather than deleting the entry. A deleted
 * entry leaves no record that the guild was ever targeted, and nothing here or
 * in Discord can then tell that guild apart from one that never had it.
 *
 * @throws for the same reason `listGuildsWithFlagEnabled` does.
 */
export function listGuildsWithFlagDeclared(name: FlagName): DiscordGuildId[] {
  return listWholeGuildOverrides(name, () => true);
}

/**
 * Guilds named by an override whose *sole* attribute is `server` and whose
 * value the caller accepts.
 *
 * The specificity check is the point: a more specific override such as
 * `{ server, user }` enables the flag for one person in that guild, which is
 * not the same as the guild having the feature.
 */
function listWholeGuildOverrides(
  name: FlagName,
  accept: (value: boolean) => boolean,
): DiscordGuildId[] {
  if (isFeatureHardDisabled(name)) {
    return [];
  }
  const config = FLAG_REGISTRY[name];
  if (config.default) {
    throw new Error(
      `Flag "${name}" defaults to true, so it has no finite guild list`,
    );
  }

  const guilds = new Set<DiscordGuildId>();
  for (const override of config.overrides) {
    if (!accept(override.value)) {
      continue;
    }
    const server = override.attributes.server;
    if (
      server === undefined ||
      calculateSpecificity(override.attributes) !== 1
    ) {
      continue;
    }
    guilds.add(server);
  }
  return [...guilds];
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
 *
 * Prefer pairing this with `resetFlagOverrides` in an `afterEach`: the registry
 * is process-wide, so a cleared flag stays cleared for every test file that
 * runs after this one.
 */
export function clearFlagOverrides(name: FlagName): void {
  const config = FLAG_REGISTRY[name];
  config.overrides.length = 0;
}

/**
 * Restore a flag's overrides to the ones it was declared with.
 *
 * For tests that need to leave the shared registry as they found it. Copies the
 * snapshot rather than handing it out, so a later `addFlagOverride` cannot
 * mutate the thing every future reset restores from.
 */
export function resetFlagOverrides(name: FlagName): void {
  const initial = INITIAL_FLAG_OVERRIDES.get(name) ?? [];
  FLAG_REGISTRY[name].overrides = initial.map((override) => ({ ...override }));
}
