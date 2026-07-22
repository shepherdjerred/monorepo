import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_REPORT_CRON,
  type DiscordAccountId,
  type DiscordGuildId,
  REPORT_ACTIVE_LIMIT_PER_OWNER_PER_SERVER,
  REPORT_ACTIVE_LIMIT_PER_SERVER,
} from "@scout-for-lol/data";
import { canCreateAnotherUserReport } from "#src/discord/commands/report/authorization.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("report-authorization-test");

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("canCreateAnotherUserReport", () => {
  test("enforces the active user report limit per owner", async () => {
    const serverId = testGuildId("711");
    const ownerId = testAccountId("711");
    for (
      let index = 0;
      index < REPORT_ACTIVE_LIMIT_PER_OWNER_PER_SERVER;
      index++
    ) {
      await createReport({
        serverId,
        ownerId,
        title: `Owner report ${index.toString()}`,
      });
    }

    const result = await canCreateAnotherUserReport({
      prisma,
      serverId,
      ownerId,
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("active reports");
    }
  });

  test("enforces the active user report limit per server", async () => {
    const serverId = testGuildId("721");
    for (let index = 0; index < REPORT_ACTIVE_LIMIT_PER_SERVER; index++) {
      await createReport({
        serverId,
        ownerId: testAccountId(`721${index.toString()}`),
        title: `Server report ${index.toString()}`,
      });
    }

    const result = await canCreateAnotherUserReport({
      prisma,
      serverId,
      ownerId: testAccountId("7219"),
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("This server already has");
    }
  });

  test("does not count disabled or system-managed reports against user caps", async () => {
    const serverId = testGuildId("731");
    const ownerId = testAccountId("731");
    await createReport({
      serverId,
      ownerId,
      title: "Disabled report",
      isEnabled: false,
    });
    await createReport({
      serverId,
      ownerId,
      title: "System report",
      isSystemManaged: true,
    });

    const result = await canCreateAnotherUserReport({
      prisma,
      serverId,
      ownerId,
    });

    expect(result).toEqual({ allowed: true });
  });
});

async function createReport(params: {
  serverId: DiscordGuildId;
  ownerId: DiscordAccountId;
  title: string;
  isEnabled?: boolean;
  isSystemManaged?: boolean;
}): Promise<void> {
  await prisma.report.create({
    data: {
      serverId: params.serverId,
      ownerId: params.ownerId,
      channelId: testChannelId("711"),
      title: params.title,
      description: null,
      queryText:
        "SELECT player, games FROM match_participants GROUP BY player LIMIT 10",
      isEnabled: params.isEnabled ?? true,
      isSystemManaged: params.isSystemManaged ?? false,
      systemSource:
        params.isSystemManaged === true ? "COMMON_DENOMINATOR" : null,
      cronExpression: DEFAULT_REPORT_CRON,
      nextScheduledRunAt: new Date(Date.UTC(2026, 4, 17, 12, 0, 0)),
      createdTime: new Date(Date.UTC(2026, 4, 17, 12, 0, 0)),
      updatedTime: new Date(Date.UTC(2026, 4, 17, 12, 0, 0)),
    },
  });
}

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
}
