import { describe, expect, test, afterAll, beforeEach, mock } from "bun:test";
import { DiscordAPIError } from "discord.js";
import { sendDM } from "#src/discord/utils/dm.ts";
import { mockClient, mockUser } from "#src/testing/discord-mocks.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("dm-audit-test");

const recipientId = testAccountId("555");
const guildId = testGuildId("777");

function clientWithSend(send: () => Promise<unknown>) {
  const user = mockUser({
    id: recipientId,
    tag: "Recipient#1234",
    send: mock(send),
  });
  return mockClient({
    users: {
      cache: new Map(),
      fetch: () => Promise.resolve(user),
    },
  });
}

beforeEach(async () => {
  await prisma.dmAuditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendDM", () => {
  test("records a 'sent' audit row when delivery succeeds", async () => {
    const client = clientWithSend(() => Promise.resolve({}));

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "hello there",
      kind: "feedback_request",
      guildId,
      prisma,
    });

    expect(status).toBe("sent");

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.deliveryStatus).toBe("sent");
    expect(row?.kind).toBe("feedback_request");
    expect(row?.recipientId).toBe(recipientId);
    expect(row?.recipientTag).toBe("Recipient#1234");
    expect(row?.guildId).toBe(guildId);
    expect(row?.content).toBe("hello there");
    expect(row?.errorMessage).toBeNull();
  });

  test("records a 'dm_disabled' audit row when the user blocks DMs (50007)", async () => {
    const dmDisabled = new DiscordAPIError(
      { code: 50_007, message: "Cannot send messages to this user" },
      50_007,
      403,
      "POST",
      "https://discord.com/api/v10/users/@me/channels",
      { files: [], body: {} },
    );
    const client = clientWithSend(() => Promise.reject(dmDisabled));

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "prune notice",
      kind: "prune_notice",
      prisma,
    });

    expect(status).toBe("dm_disabled");

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("dm_disabled");
    expect(rows[0]?.kind).toBe("prune_notice");
    expect(rows[0]?.errorMessage).toContain(
      "Cannot send messages to this user",
    );
  });

  test("records a 'failed' audit row for any other error", async () => {
    const client = clientWithSend(() =>
      Promise.reject(new Error("network exploded")),
    );

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "permission issue",
      kind: "permission_error",
      guildId,
      prisma,
    });

    expect(status).toBe("failed");

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("failed");
    expect(rows[0]?.errorMessage).toContain("network exploded");
  });
});
