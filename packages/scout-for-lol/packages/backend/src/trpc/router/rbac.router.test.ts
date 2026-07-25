import { afterAll, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  type Permission,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  permissionKey,
  permissionsForRole,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Must run before anything imports appRouter (installs module mocks).
const trpc = await createOfflineTrpcHarness("rbac-router");

const guildId = DiscordGuildIdSchema.parse("100000000000009001");
const member = DiscordAccountIdSchema.parse("900000000000000001");
const target = DiscordAccountIdSchema.parse("900000000000000002");

async function reset() {
  await trpc.prisma.serverPermission.deleteMany({});
  await trpc.prisma.auditLog.deleteMany({});
}

async function seedGrants(userId: string, permissions: readonly Permission[]) {
  await trpc.prisma.serverPermission.createMany({
    data: permissions.map((p) => ({
      serverId: guildId,
      discordUserId: DiscordAccountIdSchema.parse(userId),
      permission: permissionKey(p),
      grantedBy: member,
      grantedAt: new Date(),
    })),
  });
}

function asMember() {
  trpc.setMembership([{ guildId, asAdmin: false }]);
}

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("RBAC guild-permission gate", () => {
  test("Discord admin (root) can read without any grants", async () => {
    await reset();
    trpc.setMembership("root");
    const caller = trpc.authedCaller(member);
    await expect(caller.subscription.list({ guildId })).resolves.toMatchObject({
      items: [],
    });
    await expect(caller.roles.list({ guildId })).resolves.toEqual([]);
  });

  test("non-member is FORBIDDEN even with a session", async () => {
    await reset();
    trpc.setMembership([]); // member of no guilds
    const caller = trpc.authedCaller(member);
    await expect(caller.subscription.list({ guildId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("member with subscriptions:read can read but not create", async () => {
    await reset();
    asMember();
    await seedGrants(member, [{ resource: "subscriptions", action: "read" }]);
    const caller = trpc.authedCaller(member);

    await expect(caller.subscription.list({ guildId })).resolves.toMatchObject({
      items: [],
    });

    let denied: unknown;
    try {
      await caller.subscription.add({
        guildId,
        channelId: "111111111111111111",
        region: "AMERICA_NORTH",
        riotId: "abc#na1",
        alias: "x",
      });
    } catch (error) {
      denied = error;
    }
    expect(denied).toBeInstanceOf(TRPCError);
    if (!(denied instanceof TRPCError)) throw new Error("expected TRPCError");
    expect(denied.code).toBe("FORBIDDEN");
    expect(denied.cause).toMatchObject({
      missingPermission: { resource: "subscriptions", action: "create" },
    });
  });

  test("member with no grants is FORBIDDEN on every guild procedure", async () => {
    await reset();
    asMember();
    const caller = trpc.authedCaller(member);
    await expect(caller.subscription.list({ guildId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.report.list({ guildId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("manager can manage but cannot touch roles", async () => {
    await reset();
    asMember();
    await seedGrants(member, permissionsForRole("manager"));
    const caller = trpc.authedCaller(member);

    await expect(caller.report.list({ guildId })).resolves.toEqual([]);
    await expect(
      caller.subscription.listAuditLog({ guildId }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(caller.roles.list({ guildId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("viewer sees reads only and appears in listManageable", async () => {
    await reset();
    asMember();
    await seedGrants(member, permissionsForRole("viewer"));
    const caller = trpc.authedCaller(member);

    await expect(caller.subscription.list({ guildId })).resolves.toMatchObject({
      items: [],
    });
    // Viewer lacks audit:read.
    await expect(
      caller.subscription.listAuditLog({ guildId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const manageable = await caller.guild.listManageable();
    const entry = manageable.find((g) => g.id === guildId);
    expect(entry).toBeDefined();
    expect(entry?.isDiscordAdmin).toBe(false);
    expect(entry?.permissions).toContainEqual({
      resource: "subscriptions",
      action: "read",
    });
  });

  test("legacy Discord grant (CREATE_COMPETITION) is honored by the RBAC reader", async () => {
    await reset();
    asMember();
    // The `/competition grant-permission` Discord command persists the raw
    // legacy PermissionType enum, not a canonical `competitions:create` key.
    // The web RBAC reader must still surface it — otherwise a freshly-issued
    // grant is dropped and access is silently denied.
    await trpc.prisma.serverPermission.create({
      data: {
        serverId: guildId,
        discordUserId: member,
        permission: "CREATE_COMPETITION",
        grantedBy: member,
        grantedAt: new Date(),
      },
    });
    const caller = trpc.authedCaller(member);

    const manageable = await caller.guild.listManageable();
    const entry = manageable.find((g) => g.id === guildId);
    expect(entry).toBeDefined();
    expect(entry?.permissions).toContainEqual({
      resource: "competitions",
      action: "create",
    });
  });

  test("roles.set writes rows + a ROLE_GRANT audit entry", async () => {
    await reset();
    trpc.setMembership("root"); // an admin grants a viewer
    const caller = trpc.authedCaller(member);
    await caller.roles.set({
      guildId,
      discordUserId: target,
      permissions: permissionsForRole("viewer"),
    });

    const rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: target },
    });
    expect(rows.map((r) => r.permission).sort()).toEqual(
      permissionsForRole("viewer")
        .map((p) => permissionKey(p))
        .sort(),
    );
    const audits = await trpc.prisma.auditLog.findMany({
      where: { serverId: guildId, action: "ROLE_GRANT" },
    });
    expect(audits).toHaveLength(1);
  });

  test("self-lockout: last role-admin cannot clear their own grant", async () => {
    await reset();
    asMember();
    await seedGrants(member, permissionsForRole("admin"));
    const caller = trpc.authedCaller(member);
    await expect(
      caller.roles.clear({ guildId, discordUserId: member }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("anonymous caller is UNAUTHORIZED before any permission check", async () => {
    await reset();
    await expect(
      trpc.anonCaller().subscription.list({ guildId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
