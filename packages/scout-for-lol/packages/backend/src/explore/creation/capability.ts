/**
 * Whether — and where — an Explore turn may prepare a creation.
 *
 * The resolution is deliberately split into two tiers, and the split is the
 * most load-bearing decision in this feature:
 *
 * **Tier 1 (`resolveCreationCapability`)** runs at turn setup, on every turn.
 * It reads the surface and one feature flag per guild in scope. It performs no
 * Discord I/O and no database I/O, so an ordinary analytics question costs
 * nothing extra.
 *
 * **Tier 2 (`resolveCreationAccess`)** runs inside the first creation tool call
 * and is memoized for the rest of the turn by the tool factory. It resolves the
 * asker's real permissions, which means a Discord OAuth round trip
 * (`getFreshUserAccessToken` inside `fetchUserGuildsForRequest`) plus a
 * `ServerPermission` read per guild. Doing that at setup would put an OAuth
 * refresh on the critical path of every Explore turn, and a refresh failure
 * would then degrade turns that never intended to create anything.
 *
 * The other rule here: **an outage is never a denial.** `fetchUserGuildsForRequest`
 * is called once up front precisely so "Discord could not be reached" stays
 * distinguishable from "you have no eligible servers". A blanket per-guild
 * catch would collapse the two and tell someone they lack permission when the
 * truth is that Scout could not ask.
 */

import { TRPCError } from "@trpc/server";
import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type PermissionSet,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { client as discordClient } from "#src/discord/client.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { resolveGuildPermissions } from "#src/trpc/guild-permission.ts";

/** Tier 1: the guilds in scope whose operator has switched creation on. */
export type CreationCapability = {
  guildIds: readonly DiscordGuildId[];
};

/**
 * Tier 1. Cheap by construction: a surface comparison and one flag evaluation
 * per guild, with no Discord or database access.
 */
export async function resolveCreationCapability(input: {
  surface: ExploreSurface;
  guildIds: readonly string[];
}): Promise<CreationCapability | null> {
  if (input.surface !== "web") return null;
  const enabled: DiscordGuildId[] = [];
  for (const raw of input.guildIds) {
    const guildId = DiscordGuildIdSchema.parse(raw);
    if (
      await isPolicyEnabled("explore_creation_enabled", { server: guildId })
    ) {
      enabled.push(guildId);
    }
  }
  return enabled.length === 0 ? null : { guildIds: enabled };
}

/** One guild the asker may actually act in, with the permissions they hold. */
export type CreationGuildAccess = {
  guildId: DiscordGuildId;
  /** Display name from the bot's guild cache, for the model to name servers. */
  name: string;
  permissions: PermissionSet;
};

export type CreationAccess =
  | { kind: "resolved"; guilds: CreationGuildAccess[] }
  /**
   * Scout could not ask Discord who this person is. Distinct from an empty
   * `resolved` list on purpose: the tools must say "couldn't verify your
   * servers", never "you don't have permission".
   */
  | { kind: "verification_unavailable"; message: string };

const CREATION_VERIFICATION_UNAVAILABLE_MESSAGE =
  "Scout could not reach Discord to verify which servers you belong to. Tell the user Scout could not check their servers right now and to try again shortly. Do not tell them they lack permission.";

type CreationAccessDependencies = {
  loadUser: (discordId: DiscordAccountId) => Promise<User>;
  fetchUserGuilds: (user: User) => Promise<readonly PartialGuild[]>;
  resolvePermissions: (
    user: User,
    guildId: DiscordGuildId,
  ) => Promise<PermissionSet>;
  guildName: (guildId: DiscordGuildId) => string;
};

/**
 * The bot's cached display name for a guild.
 *
 * `resolveGuildPermissions` has already proved Scout is installed by the time
 * this is read, so a miss only happens for a dev guild override, where the id
 * is the most honest label available.
 */
function cachedGuildName(guildId: DiscordGuildId): string {
  return discordClient.guilds.cache.get(guildId)?.name ?? guildId;
}

const defaultCreationAccessDependencies: CreationAccessDependencies = {
  // `resolveGuildPermissions` takes a Prisma `User` row and the agent only
  // carries the Discord id, so the row is loaded here. A missing row is a
  // broken caller contract — the turn is being answered for a signed-in web
  // session — so it throws rather than degrading into "no permission".
  loadUser: (discordId) =>
    prisma.user.findUniqueOrThrow({ where: { discordId } }),
  fetchUserGuilds: fetchUserGuildsForRequest,
  resolvePermissions: resolveGuildPermissions,
  guildName: cachedGuildName,
};

/**
 * `UNAUTHORIZED` (their Discord grant is gone) and `SERVICE_UNAVAILABLE`
 * (Discord is down) are the two codes `discord-upstream.ts` raises when it
 * could not get an answer. Neither is a permission decision.
 */
function isVerificationOutage(error: unknown): boolean {
  return (
    error instanceof TRPCError &&
    (error.code === "UNAUTHORIZED" || error.code === "SERVICE_UNAVAILABLE")
  );
}

/**
 * `FORBIDDEN` (not a member) and `NOT_FOUND` (Scout is not installed there) are
 * real answers about one guild: it simply is not a creation target for this
 * person. Every other error is a bug and propagates.
 */
function isGuildExclusion(error: unknown): boolean {
  return (
    error instanceof TRPCError &&
    (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
  );
}

function verificationUnavailable(): CreationAccess {
  return {
    kind: "verification_unavailable",
    message: CREATION_VERIFICATION_UNAVAILABLE_MESSAGE,
  };
}

/**
 * Tier 2. Expensive, so call it lazily — see the module docblock.
 *
 * Guilds the asker cannot act in are dropped from the result; only a failure to
 * reach Discord produces `verification_unavailable`.
 */
export async function resolveCreationAccess(
  input: {
    capability: CreationCapability;
    requesterId: DiscordAccountId;
  },
  dependencies: CreationAccessDependencies = defaultCreationAccessDependencies,
): Promise<CreationAccess> {
  const user = await dependencies.loadUser(input.requesterId);
  try {
    // Once, up front. An outage is only distinguishable from "no eligible
    // guilds" while nothing has been attributed to a specific guild yet.
    await dependencies.fetchUserGuilds(user);
  } catch (error) {
    if (isVerificationOutage(error)) return verificationUnavailable();
    throw error;
  }

  const guilds: CreationGuildAccess[] = [];
  for (const guildId of input.capability.guildIds) {
    try {
      const permissions = await dependencies.resolvePermissions(user, guildId);
      guilds.push({
        guildId,
        name: dependencies.guildName(guildId),
        permissions,
      });
    } catch (error) {
      // The membership cache can expire between the probe above and this call,
      // so an outage is still possible here and still must not read as denial.
      if (isVerificationOutage(error)) return verificationUnavailable();
      if (!isGuildExclusion(error)) throw error;
    }
  }
  return { kind: "resolved", guilds };
}
