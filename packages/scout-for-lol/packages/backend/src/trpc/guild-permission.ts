/**
 * RBAC authorization — the single chokepoint for every guild-scoped web
 * procedure. Replaces the scattered `assertGuildAdmin` calls with a
 * permission-aware procedure builder so a resolver cannot forget its guard.
 *
 * The ONLY Discord signal is the admin/owner bit: a guild's Discord
 * Administrator or owner is Scout's root/sudo (all permissions). Everyone else's
 * access comes purely from Scout-managed grants in the `ServerPermission` table.
 * Membership (from the OAuth guild list) is a precondition either way.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type ActionFor,
  type DiscordGuildId,
  type PermissionDeniedCause,
  type PermissionSet,
  type Resource,
  DiscordGuildIdSchema,
  P,
  createPermissionSet,
  parseStoredPermissionKey,
  rootPermissions,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import { client as discordClient } from "#src/discord/client.ts";
import { fetchUserGuilds, hasAdministrator } from "#src/lib/discord-rest.ts";
import { webMutationProcedure, webProcedure } from "#src/trpc/trpc.ts";

const GuildIdInput = z.object({ guildId: DiscordGuildIdSchema });

/**
 * Resolve the caller's effective permissions in a guild. The one place where
 * membership + admin/owner + grant rows combine.
 *
 * - not a member ⇒ FORBIDDEN
 * - Scout not installed ⇒ NOT_FOUND
 * - Discord admin/owner ⇒ every permission ({@link rootPermissions})
 * - otherwise ⇒ the union of their validated granted rows
 *
 * Grants are read per request (no cache) so a revoke takes effect immediately;
 * only the membership/admin branch lags up to the 5-minute `fetchUserGuilds`
 * cache — the same behaviour the old `assertGuildAdmin` had.
 */
export async function resolveGuildPermissions(
  user: User,
  guildId: DiscordGuildId,
): Promise<PermissionSet> {
  const guilds = await fetchUserGuilds(user);
  const match = guilds.find((g) => g.id === guildId);
  if (match === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of that guild",
    });
  }
  if (!discordClient.guilds.cache.has(guildId)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
  if (match.owner || hasAdministrator(match.permissions)) {
    return rootPermissions();
  }
  const rows = await prisma.serverPermission.findMany({
    where: { serverId: guildId, discordUserId: user.discordId },
    select: { permission: true },
  });
  const granted = rows.map((row) => parseStoredPermissionKey(row.permission));
  return createPermissionSet(granted);
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
