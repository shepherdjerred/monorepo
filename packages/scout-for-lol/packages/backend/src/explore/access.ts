import { TRPCError } from "@trpc/server";
import type { User } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

/**
 * Access control for explore.
 *
 * Explore reads every match Scout has ingested, so it is not gated by a
 * permission on any single server — there is no server whose admins should
 * decide who may query the whole lake. Access is an operator-managed
 * allowlist of Discord servers: sign in, and be a member of one of them.
 *
 * The allowlist being empty denies everyone. It is the entire gate for this
 * surface, so a deploy that forgot to set `EXPLORE_GUILD_ALLOWLIST` must fail
 * closed rather than open the lake to every signed-in user.
 */

export function exploreAllowlist(): string[] {
  return configuration.exploreGuildAllowlist
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isExploreConfigured(): boolean {
  return exploreAllowlist().length > 0;
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
  if (allowlist.length === 0) {
    return false;
  }
  return userGuildIds.some((guildId) => allowlist.includes(guildId));
}

/**
 * Throws unless the user belongs to at least one allowlisted server.
 *
 * A Discord outage propagates as UNAUTHORIZED or SERVICE_UNAVAILABLE from
 * `fetchUserGuildsForRequest` rather than being caught here: not knowing
 * someone's servers is not the same as knowing they lack access, and
 * answering FORBIDDEN would tell them something untrue.
 */
export async function assertExploreAccess(user: User): Promise<void> {
  const allowlist = exploreAllowlist();
  if (allowlist.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Explore is not enabled.",
    });
  }

  const guilds = await fetchUserGuildsForRequest(user);
  if (
    !isExploreAllowed(
      allowlist,
      guilds.map((guild) => guild.id),
    )
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Explore is currently limited to a few servers.",
    });
  }
}
