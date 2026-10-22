/**
 * RBAC authorization — the single chokepoint for every guild-scoped web
 * procedure. Replaces the scattered `assertGuildAdmin` calls with a
 * permission-aware procedure builder so a resolver cannot forget its guard.
 *
 * The ONLY Discord signal is the admin/owner bit: a guild's Discord
 * Administrator or owner is Scout's root/sudo (all permissions). Every other
 * member holds the implicit Player role (`PLAYER_PERMISSIONS`: the
 * player-facing reads Scout already shows them in Discord) plus any
 * Scout-managed grants in the `ServerPermission` table. Membership (from the
 * OAuth guild list) is a precondition either way.
 *
 * Whether Scout is installed at all comes from `lib/discord/installed-guilds.ts`
 * rather than the gateway guild cache, so this resolver answers identically on a
 * pod with no gateway connection.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type ActionFor,
  type DiscordAccountId,
  type DiscordGuildId,
  type PermissionDeniedCause,
  type PermissionSet,
  type Resource,
  DiscordGuildIdSchema,
  P,
  createPermissionSet,
  memberPermissions,
  parseStoredPermissionKey,
  rootPermissions,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import { hasAdministrator } from "#src/lib/discord-rest.ts";
import { isScoutInstalledInGuild } from "#src/lib/discord/installed-guilds.ts";
import { botRest } from "#src/lib/discord/bot-rest.ts";
import {
  callDiscordForRequest,
  fetchUserGuildsForRequest,
} from "#src/trpc/discord-upstream.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";

const GuildIdInput = z.object({ guildId: DiscordGuildIdSchema });

/**
 * Resolve the caller's effective permissions in a guild. The one place where
 * membership + admin/owner + grant rows combine.
 *
 * - not a member ⇒ FORBIDDEN
 * - Scout not installed ⇒ NOT_FOUND
 * - Discord admin/owner ⇒ every permission ({@link rootPermissions})
 * - otherwise ⇒ the Player baseline plus their validated granted rows
 *
 * Grants are read per request (no cache) so a revoke takes effect immediately;
 * only the membership/admin branch lags up to the 5-minute `fetchUserGuilds`
 * cache — the same behaviour the old `assertGuildAdmin` had.
 *
 * If Discord itself can't be reached this throws UNAUTHORIZED or
 * SERVICE_UNAVAILABLE, never FORBIDDEN — an outage is not a permission answer.
 */
export async function resolveGuildPermissions(
  user: User,
  guildId: DiscordGuildId,
): Promise<PermissionSet> {
  const guilds = await fetchUserGuildsForRequest(user);
  const match = guilds.find((g) => g.id === guildId);
  if (match === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of that guild",
    });
  }
  const installed = await callDiscordForRequest(() =>
    isScoutInstalledInGuild(guildId),
  );
  if (!installed) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
  return match.owner || hasAdministrator(match.permissions)
    ? rootPermissions()
    : await grantedPermissions(guildId, user.discordId);
}

/** The Player baseline plus a member's Scout-managed grants in one guild. */
async function grantedPermissions(
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): Promise<PermissionSet> {
  const rows = await prisma.serverPermission.findMany({
    where: { serverId: guildId, discordUserId: discordId },
    select: { permission: true },
  });
  const granted = rows.map((row) => parseStoredPermissionKey(row.permission));
  return createPermissionSet(memberPermissions(granted));
}

function scoutNotInstalled(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Scout is not installed in that guild",
  });
}

/**
 * {@link resolveGuildPermissions} for someone Scout knows only by Discord id.
 *
 * A `/scout ask` or voice turn has no web session, and the user row Discord
 * upserts deliberately carries no OAuth token, so there is no guild list to
 * ask. Scout's bot can answer the same three questions itself — is this
 * person a member, do they own the guild, does any role they hold carry
 * Administrator — and the grants come from the same table. Same decision,
 * same errors: not a member is FORBIDDEN, Scout absent is NOT_FOUND, and an
 * unreachable Discord is never a permission answer.
 */
export async function resolveGuildPermissionsForMember(
  discordId: DiscordAccountId,
  guildId: DiscordGuildId,
): Promise<PermissionSet> {
  const reader = botRest();
  const guild = await callDiscordForRequest(() => reader.guild(guildId));
  if (guild === null) throw scoutNotInstalled();
  const member = await callDiscordForRequest(() =>
    reader.guildMember(guildId, discordId),
  );
  if (member === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of that guild",
    });
  }
  if (guild.owner_id === discordId) return rootPermissions();
  // Null here is Discord saying the guild is gone (Scout removed since the
  // first read), never "no roles": that would read as a plain member.
  const roles = await callDiscordForRequest(() => reader.guildRoles(guildId));
  if (roles === null) throw scoutNotInstalled();
  const held = new Set([guildId, ...member.roles]);
  const administrator = roles.some(
    (role) => held.has(role.id) && hasAdministrator(role.permissions),
  );
  return administrator
    ? rootPermissions()
    : await grantedPermissions(guildId, discordId);
}

async function requireGuildPermission<R extends Resource>(
  user: User,
  rawInput: unknown,
  resource: R,
  action: ActionFor<R>,
): Promise<{ guildId: DiscordGuildId; permissions: PermissionSet }> {
  const parsed = GuildIdInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "guildId is required",
    });
  }
  const permissions = await resolveGuildPermissions(user, parsed.data.guildId);
  if (!permissions.can(resource, action)) {
    const cause: PermissionDeniedCause = {
      missingPermission: P(resource, action),
    };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Missing permission ${resource}:${action}`,
      cause,
    });
  }
  return { guildId: parsed.data.guildId, permissions };
}

/**
 * A read procedure gated on a single permission. Reads `guildId` from the
 * procedure input, resolves the caller's permissions, and injects
 * `ctx.guildId` + `ctx.permissions`.
 *
 * ```ts
 * list: guildProcedure("subscriptions", "read").input(Schema).query(...)
 * ```
 */
export function guildProcedure<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
) {
  return webProcedure.use(async ({ ctx, getRawInput, next }) => {
    const { guildId, permissions } = await requireGuildPermission(
      ctx.user,
      await getRawInput(),
      resource,
      action,
    );
    return next({ ctx: { ...ctx, guildId, permissions } });
  });
}

/** Mutation counterpart of {@link guildProcedure} (adds CSRF + origin checks). */
export function guildMutationProcedure<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
) {
  return webMutationProcedure.use(async ({ ctx, getRawInput, next }) => {
    const { guildId, permissions } = await requireGuildPermission(
      ctx.user,
      await getRawInput(),
      resource,
      action,
    );
    return next({ ctx: { ...ctx, guildId, permissions } });
  });
}
