import { afterAll, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import {
  type Permission,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  permissionKey,
  permissionsForRole,
} from "@scout-for-lol/data";
import {
  checkRateLimit,
  clearAllRateLimits,
  recordCreation,
} from "#src/database/competition/rate-limit.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Must run before anything imports appRouter (installs module mocks).
const trpc = await createOfflineTrpcHarness("rbac-router");

const guildId = DiscordGuildIdSchema.parse("100000000000009001");
const member = DiscordAccountIdSchema.parse("900000000000000001");
const target = DiscordAccountIdSchema.parse("900000000000000002");
const other = DiscordAccountIdSchema.parse("900000000000000003");

async function reset() {
  await trpc.prisma.competition.deleteMany({});
  await trpc.prisma.serverPermission.deleteMany({});
  await trpc.prisma.auditLog.deleteMany({});
  clearAllRateLimits();
  trpc.setGuildMembers(guildId, [member, target, other]);
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

function competitionCreateInput() {
  return {
    guildId,
    channelId: "111111111111111111",
    title: "RBAC test competition",
    description: "Competition created by the RBAC router suite",
    visibility: "OPEN" as const,
    maxParticipants: 10,
    dates: {
      type: "FIXED_DATES" as const,
      startDate: new Date("2030-01-01T00:00:00.000Z"),
      endDate: new Date("2030-02-01T00:00:00.000Z"),
    },
    criteria: {
      type: "MOST_GAMES_PLAYED" as const,
      queue: "SOLO" as const,
    },
  };
}

async function seedTwoRoleManagers() {
  const accessPermissions: Permission[] = [
    { resource: "roles", action: "grant" },
    { resource: "roles", action: "revoke" },
  ];
  await seedGrants(member, accessPermissions);
  await seedGrants(other, accessPermissions);
}

async function expectOneRoleManagerRemains(
  requests: [Promise<unknown>, Promise<unknown>],
) {
  const results = await Promise.allSettled(requests);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const remainingGrantHolders = await trpc.prisma.serverPermission.count({
    where: {
      serverId: guildId,
      permission: permissionKey({ resource: "roles", action: "grant" }),
    },
  });
  expect(remainingGrantHolders).toBe(1);
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

  test.each([
    { resource: "players", action: "read" },
    { resource: "players", action: "link" },
    { resource: "roles", action: "grant" },
    { resource: "competitions", action: "invite" },
    { resource: "subscriptions", action: "create" },
  ] satisfies Permission[])(
    "member search accepts the $resource:$action workflow permission",
    async (permission) => {
      await reset();
      asMember();
      await seedGrants(member, [permission]);

      await expect(
        trpc.authedCaller(member).discord.searchMembers({
          guildId,
          query: "member",
        }),
      ).resolves.toEqual([]);
    },
  );

  test("member search rejects grants unrelated to member selection", async () => {
    await reset();
    asMember();
    await seedGrants(member, [{ resource: "audit", action: "read" }]);

    await expect(
      trpc.authedCaller(member).discord.searchMembers({
        guildId,
        query: "member",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  test("invalid stored permission keys fail every RBAC grant reader", async () => {
    await reset();
    asMember();
    await trpc.prisma.serverPermission.create({
      data: {
        serverId: guildId,
        discordUserId: member,
        permission: "unknown:grant",
        grantedBy: member,
        grantedAt: new Date(),
      },
    });
    const caller = trpc.authedCaller(member);
    const expected = "Invalid stored permission key: unknown:grant";

    await expect(caller.guild.myPermissions({ guildId })).rejects.toThrow(
      expected,
    );
    await expect(caller.guild.listManageable()).rejects.toThrow(expected);

    trpc.setMembership("root");
    await expect(
      trpc.authedCaller(member).roles.list({ guildId }),
    ).rejects.toThrow(expected);
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
});

describe("roles.set privilege boundaries", () => {
  test("roles.set compares legacy grants by their canonical permission", async () => {
    await reset();
    asMember();
    await seedGrants(member, [
      { resource: "roles", action: "grant" },
      { resource: "competitions", action: "create" },
      { resource: "subscriptions", action: "read" },
    ]);
    await trpc.prisma.serverPermission.create({
      data: {
        serverId: guildId,
        discordUserId: target,
        permission: "CREATE_COMPETITION",
        grantedBy: member,
        grantedAt: new Date(),
      },
    });

    await trpc.authedCaller(member).roles.set({
      guildId,
      discordUserId: target,
      permissions: [
        { resource: "competitions", action: "create" },
        { resource: "subscriptions", action: "read" },
      ],
    });

    const rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: target },
      orderBy: { permission: "asc" },
    });
    expect(rows.map((row) => row.permission)).toEqual([
      "CREATE_COMPETITION",
      "subscriptions:read",
    ]);
    expect(
      await trpc.prisma.auditLog.count({
        where: { serverId: guildId, action: "ROLE_REVOKE" },
      }),
    ).toBe(0);
  });

  test("roles.set: non-root cannot self-escalate beyond permissions they hold", async () => {
    await reset();
    asMember();
    // A caller holding ONLY roles:grant must not be able to hand themselves the
    // Admin bundle (privilege escalation).
    await seedGrants(member, [{ resource: "roles", action: "grant" }]);
    const caller = trpc.authedCaller(member);
    await expect(
      caller.roles.set({
        guildId,
        discordUserId: member,
        permissions: permissionsForRole("admin"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing escalated: they still hold only the single grant.
    const rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: member },
    });
    expect(rows.map((r) => r.permission)).toEqual([
      permissionKey({ resource: "roles", action: "grant" }),
    ]);
  });

  test("roles.set: non-root without roles:revoke cannot strip another member's grants", async () => {
    await reset();
    asMember();
    await seedGrants(member, [{ resource: "roles", action: "grant" }]);
    await seedGrants(target, [{ resource: "subscriptions", action: "read" }]);
    const caller = trpc.authedCaller(member);
    await expect(
      caller.roles.set({ guildId, discordUserId: target, permissions: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The target's grant survives.
    const rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: target },
    });
    expect(rows).toHaveLength(1);
  });

  test("roles.set: actor may delegate a held permission, then revoke it with roles:revoke", async () => {
    await reset();
    asMember();
    await seedGrants(member, [
      { resource: "roles", action: "grant" },
      { resource: "roles", action: "revoke" },
      { resource: "subscriptions", action: "read" },
    ]);
    const caller = trpc.authedCaller(member);

    // Grant a permission the actor holds → allowed.
    await caller.roles.set({
      guildId,
      discordUserId: target,
      permissions: [{ resource: "subscriptions", action: "read" }],
    });
    let rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: target },
    });
    expect(rows.map((r) => r.permission)).toEqual([
      permissionKey({ resource: "subscriptions", action: "read" }),
    ]);

    // Remove it → allowed because the actor holds roles:revoke.
    await caller.roles.set({ guildId, discordUserId: target, permissions: [] });
    rows = await trpc.prisma.serverPermission.findMany({
      where: { serverId: guildId, discordUserId: target },
    });
    expect(rows).toHaveLength(0);

    // Grant + revoke were audited distinctly.
    const grants = await trpc.prisma.auditLog.findMany({
      where: { serverId: guildId, action: "ROLE_GRANT" },
    });
    const revokes = await trpc.prisma.auditLog.findMany({
      where: { serverId: guildId, action: "ROLE_REVOKE" },
    });
    expect(grants).toHaveLength(1);
    expect(revokes).toHaveLength(1);
  });
});

describe("RBAC guard invariants", () => {
  test("roles.clear does not audit a no-op revocation", async () => {
    await reset();
    trpc.setMembership("root");

    await trpc.authedCaller(member).roles.clear({
      guildId,
      discordUserId: target,
    });

    expect(
      await trpc.prisma.auditLog.count({
        where: { serverId: guildId, action: "ROLE_REVOKE" },
      }),
    ).toBe(0);
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

  test("self-lockout: last role-admin cannot remove their own revoke capability", async () => {
    await reset();
    asMember();
    await seedGrants(member, permissionsForRole("admin"));
    const caller = trpc.authedCaller(member);
    const withoutRevoke = permissionsForRole("admin").filter(
      (permission) =>
        permissionKey(permission) !==
        permissionKey({ resource: "roles", action: "revoke" }),
    );

    await expect(
      caller.roles.set({
        guildId,
        discordUserId: member,
        permissions: withoutRevoke,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const revokeGrant = await trpc.prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId: guildId,
          discordUserId: member,
          permission: permissionKey({
            resource: "roles",
            action: "revoke",
          }),
        },
      },
    });
    expect(revokeGrant).not.toBeNull();
  });

  test("self-lockout: concurrent removals preserve one delegated role admin", async () => {
    await reset();
    asMember();
    await seedTwoRoleManagers();
    await expectOneRoleManagerRemains([
      trpc.authedCaller(member).roles.clear({ guildId, discordUserId: member }),
      trpc.authedCaller(other).roles.clear({ guildId, discordUserId: other }),
    ]);
  });

  test("cross-revocation: concurrent removals preserve one delegated role admin", async () => {
    await reset();
    asMember();
    await seedTwoRoleManagers();
    await expectOneRoleManagerRemains([
      trpc.authedCaller(member).roles.clear({ guildId, discordUserId: other }),
      trpc.authedCaller(other).roles.clear({ guildId, discordUserId: member }),
    ]);
  });

  test("stale non-member grants do not satisfy the remaining-manager invariant", async () => {
    await reset();
    asMember();
    await seedTwoRoleManagers();
    trpc.setGuildMembers(guildId, [member]);

    await expect(
      trpc.authedCaller(member).roles.clear({
        guildId,
        discordUserId: member,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const remainingCurrentManager = await trpc.prisma.serverPermission.count({
      where: {
        serverId: guildId,
        discordUserId: member,
        permission: permissionKey({ resource: "roles", action: "grant" }),
      },
    });
    expect(remainingCurrentManager).toBe(1);
  });

  test("anonymous caller is UNAUTHORIZED before any permission check", async () => {
    await reset();
    await expect(
      trpc.anonCaller().subscription.list({ guildId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("competition creation RBAC", () => {
  test("delegated creators are subject to the hourly rate limit", async () => {
    await reset();
    asMember();
    await seedGrants(member, [{ resource: "competitions", action: "create" }]);
    recordCreation(guildId, member);

    await expect(
      trpc.authedCaller(member).competition.create(competitionCreateInput()),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Rate limited"),
    });
  });

  test("successful delegated creation records the rate limit", async () => {
    await reset();
    asMember();
    await seedGrants(member, [{ resource: "competitions", action: "create" }]);
    expect(checkRateLimit(guildId, member)).toBe(true);

    await trpc
      .authedCaller(member)
      .competition.create(competitionCreateInput());

    expect(checkRateLimit(guildId, member)).toBe(false);
  });
});
