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
import { type Db, recordAudit } from "#src/lib/audit/index.ts";
import { resolveDiscordUsers } from "#src/lib/discord/resolve-users.ts";
import { client as discordClient } from "#src/discord/client.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const GRANT_KEY = permissionKey({ resource: "roles", action: "grant" });
const REVOKE_KEY = permissionKey({ resource: "roles", action: "revoke" });
const DiscordApiErrorSchema = z.object({ code: z.number() });
const UNKNOWN_MEMBER_CODE = 10_007;

async function isCurrentGuildMember(
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
): Promise<boolean> {
  const guild = discordClient.guilds.cache.get(guildId);
  if (guild === undefined) {
    throw new Error(`Discord guild ${guildId} is unavailable`);
  }

  try {
    await guild.members.fetch({ user: discordId, force: true });
    return true;
  } catch (error) {
    const parsed = DiscordApiErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.code === UNKNOWN_MEMBER_CODE) {
      return false;
    }
    throw error;
  }
}

/**
 * Prevent a non-root mutation from removing either capability from the last
 * Scout-managed role manager. A viable manager needs both `roles:grant` and
 * `roles:revoke`; retaining only grant would let them remove access without
 * being able to restore it. Discord admins (root) are exempt because they
 * always retain implicit access.
 */
async function assertPreservesRoleManager(
  tx: Db,
  params: {
    isRoot: boolean;
    guildId: DiscordGuildId;
    targetDiscordId: DiscordAccountId;
    targetHasManagerAccess: boolean;
    targetKeepsManagerAccess: boolean;
  },
): Promise<void> {
  const removesManagerAccess =
    params.targetHasManagerAccess &&
    !params.targetKeepsManagerAccess &&
    !params.isRoot;
  if (!removesManagerAccess) return;
  const otherManagerPermissionRows = await tx.serverPermission.findMany({
    where: {
      serverId: params.guildId,
      permission: { in: [GRANT_KEY, REVOKE_KEY] },
      discordUserId: { not: params.targetDiscordId },
    },
    select: { discordUserId: true, permission: true },
  });
  const permissionKeysByUser = new Map<string, Set<string>>();
  for (const row of otherManagerPermissionRows) {
    const keys = permissionKeysByUser.get(row.discordUserId) ?? new Set();
    keys.add(row.permission);
    permissionKeysByUser.set(row.discordUserId, keys);
  }
  const otherManagerIds = [...permissionKeysByUser.entries()]
    .filter(([, keys]) => keys.has(GRANT_KEY) && keys.has(REVOKE_KEY))
    .map(([discordUserId]) => DiscordAccountIdSchema.parse(discordUserId));
  const currentMemberChecks = await Promise.all(
    otherManagerIds.map((discordUserId) =>
      isCurrentGuildMember(params.guildId, discordUserId),
    ),
  );
  if (!currentMemberChecks.some(Boolean)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "You can't remove the last role manager — grant another member access first.",
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
   * Set a member's Scout grants to `permissions` (idempotent "set role"). The
   * client expands a preset via `permissionsForRole`, or sends a hand-picked
   * ("custom") set.
   *
   * The requested set is diffed against the target's current grants inside the
   * transaction, and each side is bounded so `roles:grant` alone cannot escalate
   * privileges or silently revoke:
   *
   * - **Additions** — a non-root actor may only grant permissions they hold
   *   themselves. This closes self-escalation (a `roles:grant`-only caller
   *   cannot hand themselves — or anyone — the Admin bundle).
   * - **Removals** — require `roles:revoke` for a non-root actor. Dropping a
   *   member to Viewer/`[]` is a revoke, not a grant.
   * - **Root** (Discord admin/owner) may delegate or redact any permission.
   *
   * Grants and revocations are audited as distinct `ROLE_GRANT` / `ROLE_REVOKE`
   * entries.
   */
  set: guildMutationProcedure("roles", "grant")
    .input(
      GuildInput.extend({
        discordUserId: DiscordAccountIdSchema,
        permissions: z.array(PermissionSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Dedupe the requested set to canonical keys (preserving the Permission
      // objects for authorization/audit).
      const desired = new Map<string, Permission>();
      for (const p of input.permissions) desired.set(permissionKey(p), p);
      const desiredKeys = new Set(desired.keys());

      const now = new Date();
      await prisma.$transaction(async (tx) => {
        // Read current grants inside the txn for a consistent diff.
        const currentRows = await tx.serverPermission.findMany({
          where: {
            serverId: input.guildId,
            discordUserId: input.discordUserId,
          },
          select: { permission: true },
        });
        const currentKeys = new Set(currentRows.map((r) => r.permission));

        await assertPreservesRoleManager(tx, {
          isRoot: ctx.permissions.isRoot,
          guildId: input.guildId,
          targetDiscordId: input.discordUserId,
          targetHasManagerAccess:
            currentKeys.has(GRANT_KEY) && currentKeys.has(REVOKE_KEY),
          targetKeepsManagerAccess:
            desiredKeys.has(GRANT_KEY) && desiredKeys.has(REVOKE_KEY),
        });

        const additions = [...desired.values()].filter(
          (p) => !currentKeys.has(permissionKey(p)),
        );
        const removalKeys = [...currentKeys].filter(
          (key) => !desiredKeys.has(key),
        );

        // Privilege & revoke boundaries (root bypasses — it holds everything).
        if (!ctx.permissions.isRoot) {
          const escalating = additions.filter((p) =>
            ctx.permissions.cannot(p.resource, p.action),
          );
          if (escalating.length > 0) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `You can only grant permissions you hold yourself: ${escalating
                .map((p) => permissionKey(p))
                .join(", ")}`,
            });
          }
          if (
            removalKeys.length > 0 &&
            ctx.permissions.cannot("roles", "revoke")
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Removing a member's grants requires the roles:revoke permission.",
            });
          }
        }

        if (removalKeys.length > 0) {
          await tx.serverPermission.deleteMany({
            where: {
              serverId: input.guildId,
              discordUserId: input.discordUserId,
              permission: { in: removalKeys },
            },
          });
        }
        if (additions.length > 0) {
          await tx.serverPermission.createMany({
            data: additions.map((p) => ({
              serverId: input.guildId,
              discordUserId: input.discordUserId,
              permission: permissionKey(p),
              grantedBy: ctx.user.discordId,
              grantedAt: now,
            })),
          });
        }

        if (additions.length > 0) {
          await recordAudit(
            {
              action: "ROLE_GRANT",
              actorDiscordId: ctx.user.discordId,
              serverId: input.guildId,
              payload: {
                targetUserId: input.discordUserId,
                role: deriveRole(createPermissionSet([...desired.values()])),
                permissions: additions.map((p) => permissionKey(p)),
              },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }
        if (removalKeys.length > 0) {
          await recordAudit(
            {
              action: "ROLE_REVOKE",
              actorDiscordId: ctx.user.discordId,
              serverId: input.guildId,
              payload: {
                targetUserId: input.discordUserId,
                permissions: removalKeys,
              },
              ipAddress: ctx.webSession.ipAddress,
              userAgent: ctx.webSession.userAgent,
            },
            tx,
          );
        }
      });
      return { ok: true } as const;
    }),

  /** Remove all of a member's Scout grants. */
  clear: guildMutationProcedure("roles", "revoke")
    .input(GuildInput.extend({ discordUserId: DiscordAccountIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await prisma.$transaction(async (tx) => {
        const targetManagerPermissionRows = await tx.serverPermission.findMany({
          where: {
            serverId: input.guildId,
            discordUserId: input.discordUserId,
            permission: { in: [GRANT_KEY, REVOKE_KEY] },
          },
          select: { permission: true },
        });
        const targetManagerPermissionKeys = new Set(
          targetManagerPermissionRows.map((row) => row.permission),
        );
        await assertPreservesRoleManager(tx, {
          isRoot: ctx.permissions.isRoot,
          guildId: input.guildId,
          targetDiscordId: input.discordUserId,
          targetHasManagerAccess:
            targetManagerPermissionKeys.has(GRANT_KEY) &&
            targetManagerPermissionKeys.has(REVOKE_KEY),
          targetKeepsManagerAccess: false,
        });

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
