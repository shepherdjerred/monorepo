import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { grantPermission, hasPermission } from "@scout-for-lol/backend/database/competition/permissions.ts";
import { testGuildId, testAccountId } from "@scout-for-lol/backend/testing/test-ids.ts";
import { createTestDatabase } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("grant-permission-test");

beforeEach(async () => {
  // Clean up database before each test
  await prisma.serverPermission.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Admin grants permission
// ============================================================================

describe("Admin grants permission", () => {
  test("creates ServerPermission record with correct fields", async () => {
    const serverId = testGuildId("123456789012345678");
    const adminId = testAccountId("111111111111111111");
    const userId = testAccountId("222222222222222222");

    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Verify permission was created
    const permission = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: userId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(permission).not.toBeNull();
    if (permission) {
      expect(permission.serverId).toBe(serverId);
      expect(permission.discordUserId).toBe(userId);
      expect(permission.permission).toBe("CREATE_COMPETITION");
      expect(permission.grantedBy).toBe(adminId);
      expect(permission.grantedAt).toBeInstanceOf(Date);
    }
  });

  test("user can be verified to have permission", async () => {
    const serverId = testGuildId("123456789012345678");
    const adminId = testAccountId("111111111111111111");
    const userId = testAccountId("222222222222222222");

    // Before granting
    const beforeGrant = await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION");
    expect(beforeGrant).toBe(false);

    // Grant permission
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // After granting
    const afterGrant = await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION");
    expect(afterGrant).toBe(true);
  });
});

// ============================================================================
// Idempotent grants
// ============================================================================

describe("Idempotent grants", () => {
  test("granting permission twice creates only one record", async () => {
    const serverId = testGuildId("123456789012345678");
    const adminId = testAccountId("111111111111111111");
    const userId = testAccountId("222222222222222222");

    // First grant
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Second grant (should be idempotent)
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Verify only one record exists
    const permissions = await prisma.serverPermission.findMany({
      where: {
        serverId,
        discordUserId: userId,
        permission: "CREATE_COMPETITION",
      },
    });

    expect(permissions).toHaveLength(1);
  });

  test("granting permission twice updates grantedBy and grantedAt", async () => {
    const serverId = testGuildId("123456789012345678");
    const admin1Id = testAccountId("111111111111111111");
    const admin2Id = testAccountId("333333333333333333");
    const userId = testAccountId("222222222222222222");

    // First grant by admin1
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: admin1Id,
    });

    const firstGrant = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: userId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(firstGrant).not.toBeNull();
    if (firstGrant) {
      expect(firstGrant.grantedBy).toBe(admin1Id);
    }

    // Small delay to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second grant by admin2
    await grantPermission(prisma, {
      serverId,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: admin2Id,
    });

    const secondGrant = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: userId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(secondGrant).not.toBeNull();
    if (secondGrant && firstGrant) {
      expect(secondGrant.grantedBy).toBe(admin2Id);
      expect(secondGrant.grantedAt.getTime()).toBeGreaterThan(firstGrant.grantedAt.getTime());
    }
  });
});

// ============================================================================
// Grant to self
// ============================================================================

describe("Grant to self", () => {
  test("admin can grant permission to themselves", async () => {
    const serverId = testGuildId("123456789012345678");
    const adminId = testAccountId("111111111111111111");

    await grantPermission(prisma, {
      serverId,
      userId: adminId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    const permission = await prisma.serverPermission.findUnique({
      where: {
        serverId_discordUserId_permission: {
          serverId,
          discordUserId: adminId,
          permission: "CREATE_COMPETITION",
        },
      },
    });

    expect(permission).not.toBeNull();
    if (permission) {
      expect(permission.discordUserId).toBe(adminId);
      expect(permission.grantedBy).toBe(adminId);
    }
  });
});

// ============================================================================
// Server-specific permissions
// ============================================================================

describe("Server-specific permissions", () => {
  test("permission granted on one server doesn't apply to another", async () => {
    const server1Id = testGuildId("123456789012345678");
    const server2Id = testGuildId("987654321098765432");
    const adminId = testAccountId("111111111111111111");
    const userId = testAccountId("222222222222222222");

    // Grant on server 1
    await grantPermission(prisma, {
      serverId: server1Id,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Check server 1 - should have permission
    const hasOnServer1 = await hasPermission(prisma, server1Id, userId, "CREATE_COMPETITION");
    expect(hasOnServer1).toBe(true);

    // Check server 2 - should NOT have permission
    const hasOnServer2 = await hasPermission(prisma, server2Id, userId, "CREATE_COMPETITION");
    expect(hasOnServer2).toBe(false);
  });

  test("user can have permission on multiple servers independently", async () => {
    const server1Id = testGuildId("123456789012345678");
    const server2Id = testGuildId("987654321098765432");
    const admin1Id = testAccountId("111111111111111111");
    const admin2Id = testAccountId("333333333333333333");
    const userId = testAccountId("222222222222222222");

    // Grant on server 1
    await grantPermission(prisma, {
      serverId: server1Id,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: admin1Id,
    });

    // Grant on server 2
    await grantPermission(prisma, {
      serverId: server2Id,
      userId,
      permission: "CREATE_COMPETITION",
      grantedBy: admin2Id,
    });

    // Verify both permissions exist
    const hasOnServer1 = await hasPermission(prisma, server1Id, userId, "CREATE_COMPETITION");
    const hasOnServer2 = await hasPermission(prisma, server2Id, userId, "CREATE_COMPETITION");

    expect(hasOnServer1).toBe(true);
    expect(hasOnServer2).toBe(true);

    // Verify separate records
    const allPermissions = await prisma.serverPermission.findMany({
      where: {
        discordUserId: userId,
        permission: "CREATE_COMPETITION",
      },
    });

    expect(allPermissions).toHaveLength(2);
  });
});

// ============================================================================
// Multiple users
// ============================================================================

describe("Multiple users", () => {
  test("can grant permission to multiple users on same server", async () => {
    const serverId = testGuildId("123456789012345678");
    const adminId = testAccountId("111111111111111111");
    const user1Id = testAccountId("222222222222222222");
    const user2Id = testAccountId("333333333333333333");
    const user3Id = testAccountId("444444444444444444");

    await grantPermission(prisma, {
      serverId,
      userId: user1Id,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });
    await grantPermission(prisma, {
      serverId,
      userId: user2Id,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });
    await grantPermission(prisma, {
      serverId,
      userId: user3Id,
      permission: "CREATE_COMPETITION",
      grantedBy: adminId,
    });

    // Verify all have permission
    const user1Has = await hasPermission(prisma, serverId, user1Id, "CREATE_COMPETITION");
    const user2Has = await hasPermission(prisma, serverId, user2Id, "CREATE_COMPETITION");
    const user3Has = await hasPermission(prisma, serverId, user3Id, "CREATE_COMPETITION");

    expect(user1Has).toBe(true);
    expect(user2Has).toBe(true);
    expect(user3Has).toBe(true);

    // Verify count
    const allPermissions = await prisma.serverPermission.findMany({
      where: {
        serverId,
        permission: "CREATE_COMPETITION",
      },
    });

    expect(allPermissions).toHaveLength(3);
  });
});
