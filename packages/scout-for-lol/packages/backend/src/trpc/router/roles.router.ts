/**
 * Web-UI role/access management (the "Access" tab). Grants are stored one row
 * per permission in `ServerPermission`; a role is just a preset bundle the
 * client expands into `permissions[]`. Gated on `roles:{read,grant,revoke}`.
 *
 * Discord admins/owners always hold every permission implicitly and are not
 * listed as grant rows.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  type DiscordAccountId,
  type DiscordGuildId,
  type Permission,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PermissionSchema,
  createPermissionSet,
  deriveRole,
  parseStoredPermissionKey,
  permissionKey,
} from "@scout-for-lol/data";
import { router } from "#src/trpc/trpc.ts";
import {
  guildMutationProcedure,
  guildProcedure,
} from "#src/trpc/guild-permission.ts";
import { prisma } from "#src/database/index.ts";
import { recordAudit } from "#src/lib/audit/index.ts";
import { resolveDiscordUsers } from "#src/lib/discord/resolve-users.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const GRANT_KEY = permissionKey({ resource: "roles", action: "grant" });

/**
 * Prevent a non-root user from removing the last Scout-managed `roles:grant`
 * (which would leave nobody but Discord admins able to manage access). Discord
 * admins (root) are exempt — they always retain implicit access.
 */
async function assertNotSelfLockout(params: {
  isRoot: boolean;
  guildId: DiscordGuildId;
  actorDiscordId: DiscordAccountId;
  targetDiscordId: DiscordAccountId;
  keepsGrant: boolean;
}): Promise<void> {
  const removingOwnGrant =
    params.targetDiscordId === params.actorDiscordId &&
    !params.keepsGrant &&
    !params.isRoot;
  if (!removingOwnGrant) return;
  const otherGrantHolders = await prisma.serverPermission.count({
    where: {
      serverId: params.guildId,
      permission: GRANT_KEY,
      discordUserId: { not: params.actorDiscordId },
    },
  });
  if (otherGrantHolders === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "You can't remove your own role management here — grant another member access first.",
    });
  }
}

export const rolesRouter = router({
  /** Every member with an explicit Scout grant, plus their derived role. */
  list: guildProcedure("roles", "read")
    .input(GuildInput)
    .query(async ({ input }) => {
      const rows = await prisma.serverPermission.findMany({
        where: { serverId: input.guildId },
        orderBy: [{ discordUserId: "asc" }, { permission: "asc" }],
      });
      const byUser = new Map<
        string,
        { permissions: Permission[]; grantedBy: string; grantedAt: Date }
      >();
      for (const row of rows) {
        const permission = parseStoredPermissionKey(row.permission);
        if (permission === undefined) continue;
        const entry = byUser.get(row.discordUserId) ?? {
          permissions: [],
          grantedBy: row.grantedBy,
          grantedAt: row.grantedAt,
        };
        entry.permissions.push(permission);
        // Surface the most recent grant time for the row.
        if (row.grantedAt > entry.grantedAt) {
          entry.grantedAt = row.grantedAt;
          entry.grantedBy = row.grantedBy;
        }
        byUser.set(row.discordUserId, entry);
      }
      const names = await resolveDiscordUsers([...byUser.keys()]);
      return [...byUser.entries()].map(([discordUserId, entry]) => ({
        discordUserId,
        username: names[discordUserId]?.displayName ?? discordUserId,
        avatar: names[discordUserId]?.avatar ?? null,
        permissions: entry.permissions,
        role: deriveRole(createPermissionSet(entry.permissions)),
        grantedBy: entry.grantedBy,
        grantedAt: entry.grantedAt,
      }));
    }),

  /**
   * Replace a member's Scout grants with `permissions` (idempotent "set role").
   * The client expands a preset via `permissionsForRole`, or sends a hand-picked
   * ("custom") set.
   */
  set: guildMutationProcedure("roles", "grant")
    .input(
      GuildInput.extend({
        discordUserId: DiscordAccountIdSchema,
        permissions: z.array(PermissionSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Dedupe to canonical keys.
      const keys = [...new Set(input.permissions.map((p) => permissionKey(p)))];
      await assertNotSelfLockout({
        isRoot: ctx.permissions.isRoot,
        guildId: input.guildId,
        actorDiscordId: ctx.user.discordId,
        targetDiscordId: input.discordUserId,
        keepsGrant: keys.includes(GRANT_KEY),
      });
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.serverPermission.deleteMany({
          where: {
            serverId: input.guildId,
            discordUserId: input.discordUserId,
          },
        });
        if (keys.length > 0) {
          await tx.serverPermission.createMany({
            data: keys.map((key) => ({
              serverId: input.guildId,
              discordUserId: input.discordUserId,
              permission: key,
              grantedBy: ctx.user.discordId,
              grantedAt: now,
            })),
          });
        }
        await recordAudit(
          {
            action: "ROLE_GRANT",
            actorDiscordId: ctx.user.discordId,
            serverId: input.guildId,
            payload: {
              targetUserId: input.discordUserId,
              role: deriveRole(createPermissionSet(input.permissions)),
              permissions: keys,
            },
            ipAddress: ctx.webSession.ipAddress,
            userAgent: ctx.webSession.userAgent,
          },
          tx,
        );
      });
      return { ok: true } as const;
    }),

  /** Remove all of a member's Scout grants. */
  clear: guildMutationProcedure("roles", "revoke")
    .input(GuildInput.extend({ discordUserId: DiscordAccountIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertNotSelfLockout({
        isRoot: ctx.permissions.isRoot,
        guildId: input.guildId,
        actorDiscordId: ctx.user.discordId,
        targetDiscordId: input.discordUserId,
        keepsGrant: false,
      });
      await prisma.$transaction(async (tx) => {
        await tx.serverPermission.deleteMany({
          where: {
            serverId: input.guildId,
            discordUserId: input.discordUserId,
          },
        });
        await recordAudit(
          {
            action: "ROLE_REVOKE",
            actorDiscordId: ctx.user.discordId,
            serverId: input.guildId,
            payload: { targetUserId: input.discordUserId },
            ipAddress: ctx.webSession.ipAddress,
            userAgent: ctx.webSession.userAgent,
          },
          tx,
        );
      });
      return { ok: true } as const;
    }),
});
