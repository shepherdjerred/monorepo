import { TRPCError } from "@trpc/server";
import type { User } from "#generated/prisma/client/index.js";
import type { Environment } from "#src/configuration.ts";
import configuration from "#src/configuration.ts";
import {
  exploreGuildAllowlist,
  isDynamicConfigReady,
} from "#src/config/dynamic.ts";
import {
  eligibleConsumerGuildIds,
  resolveConsumerAccess,
  resolveConsumerGuildAccess,
} from "#src/consumer/access.ts";

/**
 * Access control for explore.
 *
 * Explore reads every match Scout has ingested, so server administrators do
 * not grant access to the lake. Beta uses an operator-managed guild allowlist.
 * Production admits signed-in users who share at least one guild with the
 * production bot.
 */

export function exploreAllowlist(): string[] {
  // Reads the dynamic snapshot once startup has initialized it, and the
  // env-derived configuration before that. Both produce the same value until
  // someone creates the `explore-guild-allowlist` flag, so this is a no-op
  // migration; the fallback exists because this function is called from guild
  // command registration, where an empty array would UNREGISTER `/scout`
  // rather than merely disable it.
  const source = isDynamicConfigReady()
    ? exploreGuildAllowlist()
    : configuration.exploreGuildAllowlist;
  return source
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isExploreConfigured(): boolean {
  return configuration.environment === "prod" || exploreAllowlist().length > 0;
}

/** Whether Discord Explore is enabled in this exact guild right now. */
export function isExploreGuildAllowed(guildId: string): boolean {
  return (
    configuration.environment === "prod" || exploreAllowlist().includes(guildId)
  );
}

/** Guilds that receive beta's guild-scoped `/scout` registration. */
export function exploreGuildCommandGuildIds(): string[] {
  return configuration.environment === "prod" ? [] : exploreAllowlist();
}

export function eligibleExploreGuildIds(
  allowedGuildIds: Iterable<string>,
  userGuildIds: string[],
): string[] {
  return eligibleConsumerGuildIds(allowedGuildIds, userGuildIds);
}

export type ExploreAccessResult = ReturnType<typeof resolveConsumerAccess>;

export function resolveExploreAccess(
  environment: Environment,
  allowlist: string[],
  userGuildIds: string[],
  connectedGuildIds: Iterable<string> | undefined,
): ExploreAccessResult {
  return resolveConsumerAccess(
    environment,
    allowlist,
    userGuildIds,
    connectedGuildIds,
  );
}

/**
 * The access decision itself, separated from fetching the user's servers so
 * it can be tested without a Discord double.
 *
 * An empty allowlist denies rather than admits: this is the whole gate, so
 * "not configured" has to mean "nobody", never "everybody".
 */
export function isExploreAllowed(
  allowlist: string[],
  userGuildIds: string[],
): boolean {
  return eligibleExploreGuildIds(allowlist, userGuildIds).length > 0;
}

/**
 * Throws unless the user belongs to at least one eligible server for this
 * stage.
 *
 * A Discord outage propagates as UNAUTHORIZED or SERVICE_UNAVAILABLE from
 * `fetchUserGuildsForRequest` rather than being caught here: not knowing
 * someone's servers is not the same as knowing they lack access, and
 * answering FORBIDDEN would tell them something untrue.
 */
/**
 * The asker's eligible servers, which double as the scope for alias resolution.
 *
 * Returned rather than discarded: `player('…')` resolves a Scout alias from
 * the accounts dimension, which is per-server data, so it must answer only for
 * servers this person actually belongs to and may use for this stage.
 */
export async function assertExploreAccess(user: User): Promise<string[]> {
  const allowlist = exploreAllowlist();
  const production = configuration.environment === "prod";
  if (!production && allowlist.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Explore is not enabled.",
    });
  }

  const access = await resolveConsumerGuildAccess(user, allowlist);
  if (access.kind === "unavailable") {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Scout could not verify its connected servers.",
    });
  }
  if (access.kind === "forbidden") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: production
        ? "Join a server that uses Scout to access Explore."
        : "Explore is currently limited to a few servers.",
    });
  }
  return access.guilds.map((guild) => guild.id);
}
