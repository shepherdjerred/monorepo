import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PermissionsBitField, PermissionFlagsBits } from "discord.js";
import {
  canCreateCompetition,
  grantPermission,
  hasPermission,
  revokePermission,
} from "@scout-for-lol/backend/database/competition/permissions.ts";
import {
  clearAllRateLimits,
  recordCreation,
} from "@scout-for-lol/backend/database/competition/rate-limit.ts";

import {
  testGuildId,
  testAccountId,
} from "@scout-for-lol/backend/testing/test-ids.ts";
import { createTestDatabase } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database
const { prisma } = createTestDatabase("permissions-test");

// Clean up before each test
beforeEach(async () => {
  await prisma.serverPermission.deleteMany();
  clearAllRateLimits();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// hasPermission
// ============================================================================

describe("hasPermission", () => {
  test("returns true for user with granted permission", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    const result = await hasPermission(
      prisma,
      serverId,
      userId,
      "CREATE_COMPETITION",
    );
    expect(result).toBe(true);
  });

  test("returns false for user without permission", async () => {
    const result = await hasPermission(
      prisma,
      testGuildId("123456789012345678"),
      testAccountId("987654321098765432"),
      "CREATE_COMPETITION",
    );
    expect(result).toBe(false);
  });

  test("permission is server-specific", async () => {
    const userId = testAccountId("987654321098765432");

    // Grant on server1
    await grantPermission(prisma, {
      serverId: testGuildId("111111111111111111"),
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    // Has permission on server1
    expect(
      await hasPermission(
        prisma,
        testGuildId("111111111111111111"),
        userId,
        "CREATE_COMPETITION",
      ),
    ).toBe(true);

    // Does NOT have permission on server2
    expect(
      await hasPermission(
        prisma,
        testGuildId("222222222222222222"),
        userId,
        "CREATE_COMPETITION",
      ),
    ).toBe(false);
  });
});

// ============================================================================
// grantPermission
// ============================================================================

describe("grantPermission", () => {
  test("creates ServerPermission record", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");
    const adminId = testAccountId("111111111111111111");

    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    const record = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: userId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(record).not.toBeNull();
    expect(record?.grantedBy).toBe(adminId);
    expect(record?.grantedAt).toBeInstanceOf(Date);
  });

  test("is idempotent - granting twice does not error", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");
    const adminId = testAccountId("111111111111111111");

    // Grant twice
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Should still only have one record
    const count = await prisma.serverPermission.count({
      where: {
        serverId,
        discordUserId: userId,
        permission: "CREATE_COMPETITION",
      },
    });

    expect(count).toBe(1);
  });

  test("updates grantedBy on re-grant", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Grant by admin1
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("10000000100"),
    });

    // Re-grant by admin2
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("20000000200"),
    });

    const record = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: userId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(record?.grantedBy).toBe(testAccountId("20000000200"));
  });
});

// ============================================================================
// revokePermission
// ============================================================================

describe("revokePermission", () => {
  test("deletes ServerPermission record", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Grant permission
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    expect(
      await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION"),
    ).toBe(true);

    // Revoke permission
    await revokePermission(prisma, serverId, userId, "CREATE_COMPETITION");

    expect(
      await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION"),
    ).toBe(false);
  });

  test("is idempotent - revoking twice does not error", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Revoke when no permission exists
    await revokePermission(prisma, serverId, userId, "CREATE_COMPETITION");

    // Should not throw
    await revokePermission(prisma, serverId, userId, "CREATE_COMPETITION");
  });
});

// ============================================================================
// canCreateCompetition - Admin Bypass
// ============================================================================

describe("canCreateCompetition - admin bypass", () => {
  test("admin with Administrator permission always allowed", async () => {
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.Administrator,
    );

    const result = await canCreateCompetition(
      prisma,
      testGuildId("123456789012345678"),
      testAccountId("987654321098765432"),
      permissions,
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("admin bypass works without ServerPermission grant", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Verify no permission grant
    expect(
      await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION"),
    ).toBe(false);

    // Admin should still be allowed
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.Administrator,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.allowed).toBe(true);
  });

  test("admin bypass ignores rate limit", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Record creation to trigger rate limit
    recordCreation(serverId, userId);

    // Admin should still be allowed
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.Administrator,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// canCreateCompetition - Permission Grant
// ============================================================================

describe("canCreateCompetition - granted permission", () => {
  test("user with grant allowed (no rate limit)", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Grant permission
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    // Non-admin permissions
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.SendMessages,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.allowed).toBe(true);
  });

  test("user without grant denied", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Non-admin permissions, no grant
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.SendMessages,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Missing CREATE_COMPETITION permission");
  });
});

// ============================================================================
// canCreateCompetition - Rate Limit Integration
// ============================================================================

describe("canCreateCompetition - rate limit", () => {
  test("user with grant but rate limited is denied", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    // Grant permission
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    // Record creation to trigger rate limit
    recordCreation(serverId, userId);

    // Non-admin permissions
    const permissions = new PermissionsBitField(
      PermissionFlagsBits.SendMessages,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limited");
    expect(result.reason).toContain("minute");
  });

  test("rate limit error message shows time remaining", async () => {
    const serverId = testGuildId("123456789012345678");
    const userId = testAccountId("987654321098765432");

    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: testAccountId("12300000000"),
    });

    recordCreation(serverId, userId);

    const permissions = new PermissionsBitField(
      PermissionFlagsBits.SendMessages,
    );

    const result = await canCreateCompetition(
      prisma,
      serverId,
      userId,
      permissions,
    );

    expect(result.reason).toMatch(/Try again in \d+ minute/);
  });
});
