/**
 * Whether — and where — an Explore turn may prepare a creation.
 *
 * The resolution is deliberately split into two tiers, and the split is the
 * most load-bearing decision in this feature:
 *
 * **Tier 1 (`resolveCreationCapability`)** runs at turn setup, on every turn.
 * It reads one feature flag per guild in scope. It performs no Discord I/O and
 * no database I/O, so an ordinary analytics question costs nothing extra. Every
 * surface gets the same answer: web, `/scout ask` and voice prepare the same
 * creations, and only how the asker confirms differs.
 *
 * **Tier 2 (`resolveCreationAccess`)** runs inside the first creation tool call
 * and is memoized for the rest of the turn by the tool factory. It resolves the
 * asker's real permissions: on the web through a Discord OAuth round trip
 * (`getFreshUserAccessToken` inside `fetchUserGuildsForRequest`), on Discord
 * and voice through Scout's bot (`resolveGuildPermissionsForMember`), because
 * those askers have no OAuth token. Both add a `ServerPermission` read per guild. Doing that at setup would put an OAuth
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
import { installedGuildName } from "#src/lib/discord/installed-guilds.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import {
  resolveGuildPermissions,
  resolveGuildPermissionsForMember,
} from "#src/trpc/guild-permission.ts";

/** Tier 1: the guilds in scope whose operator has switched creation on. */
export type CreationCapability = {
  guildIds: readonly DiscordGuildId[];
  /** Decides how tier 2 learns the asker's permissions, never whether it may. */
  surface: ExploreSurface;
};

/**
 * Tier 1. Cheap by construction: one flag evaluation per guild, with no
 * Discord or database access.
 */
export async function resolveCreationCapability(input: {
  surface: ExploreSurface;
  guildIds: readonly DiscordGuildId[];
}): Promise<CreationCapability | null> {
  const enabled: DiscordGuildId[] = [];
  for (const raw of input.guildIds) {
    const guildId = DiscordGuildIdSchema.parse(raw);
    if (
      await isPolicyEnabled("explore_creation_enabled", { server: guildId })
    ) {
      enabled.push(guildId);
    }
  }
  return enabled.length === 0
    ? null
    : { guildIds: enabled, surface: input.surface };
}

/** One guild the asker may actually act in, with the permissions they hold. */
export type CreationGuildAccess = {
  guildId: DiscordGuildId;
  /** Display name recorded at install time, for the model to name servers. */
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
  resolveMemberPermissions: (
    discordId: DiscordAccountId,
    guildId: DiscordGuildId,
  ) => Promise<PermissionSet>;
  guildName: (guildId: DiscordGuildId) => Promise<string>;
};

/**
 * The guild's recorded display name.
 *
 * Read from the `GuildInstall` row that `guildCreate` refreshes on every
 * install, rather than the bot's gateway cache, so an Explore turn served by a
 * gatewayless pod names servers the same way. `resolveGuildPermissions` has
 * already proved Scout is installed by the time this is read, so a miss only
 * happens for a dev guild override, where the id is the most honest label
 * available.
 */
async function recordedGuildName(guildId: DiscordGuildId): Promise<string> {
  return (await installedGuildName(guildId)) ?? guildId;
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
  resolveMemberPermissions: resolveGuildPermissionsForMember,
  guildName: recordedGuildName,
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
/**
 * How tier 2 learns the asker's permissions in one guild, by surface.
 *
 * The web probes the OAuth guild list once up front, so an outage is told
 * apart from "no eligible guilds" before any guild is judged. Discord and voice
 * have no OAuth token; the bot answers per guild, and its errors keep the same
 * outage-versus-denial meaning.
 */
async function permissionSource(
  input: { capability: CreationCapability; requesterId: DiscordAccountId },
  dependencies: CreationAccessDependencies,
): Promise<
  | ((guildId: DiscordGuildId) => Promise<PermissionSet>)
  | { readonly outage: true }
> {
  if (input.capability.surface !== "web") {
    return (guildId) =>
      dependencies.resolveMemberPermissions(input.requesterId, guildId);
  }
  const user = await dependencies.loadUser(input.requesterId);
  try {
    await dependencies.fetchUserGuilds(user);
  } catch (error) {
    if (isVerificationOutage(error)) return { outage: true };
    throw error;
  }
  return (guildId) => dependencies.resolvePermissions(user, guildId);
}

export async function resolveCreationAccess(
  input: {
    capability: CreationCapability;
    requesterId: DiscordAccountId;
  },
  dependencies: CreationAccessDependencies = defaultCreationAccessDependencies,
): Promise<CreationAccess> {
  const permissionsIn = await permissionSource(input, dependencies);
  if (typeof permissionsIn !== "function") return verificationUnavailable();

  const guilds: CreationGuildAccess[] = [];
  for (const guildId of input.capability.guildIds) {
    try {
      const permissions = await permissionsIn(guildId);
      guilds.push({
        guildId,
        name: await dependencies.guildName(guildId),
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
