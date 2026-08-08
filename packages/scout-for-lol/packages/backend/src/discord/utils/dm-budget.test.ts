/**
 * Non-core message budget enforcement.
 *
 * Scout tells users in the body of every message that it will send at most
 * three setup messages per server, ever. These tests are what make that a
 * guarantee rather than a claim — the budget is enforced inside `sendDM`, the
 * single chokepoint, so no caller can bypass it.
 */

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { DiscordAPIError, type Client } from "discord.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mockClient } from "#src/testing/discord-mocks.ts";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { NON_CORE_MESSAGE_BUDGET } from "#src/discord/utils/message-budget.ts";

const { prisma } = createTestDatabase("dm-budget-test");

const SERVER_ID = testGuildId("700");
const RECIPIENT = testAccountId("42");

type SendMock = ReturnType<typeof makeSendMock>;

/** A DM send spy whose first argument is the message body. */
function makeSendMock() {
  return mock((_body: unknown) => Promise.resolve({}));
}

/** A Discord client whose DMs always succeed. */
function clientThatSends(send: SendMock) {
  return mockClient({
    users: {
      fetch: mock(() => Promise.resolve({ tag: "tester#0001", send })),
    },
  });
}

/** A Discord client that rejects DMs the way a closed-DM recipient does. */
function clientThatCannotDm() {
  return mockClient({
    users: {
      fetch: mock(() =>
        Promise.resolve({
          tag: "tester#0001",
          send: mock(() =>
            Promise.reject(
              new DiscordAPIError(
                { code: 50_007, message: "Cannot send messages to this user" },
                50_007,
                403,
                "POST",
                "",
                {},
              ),
            ),
          ),
        }),
      ),
    },
  });
}

async function seedInstall(outreachStage = 0): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Budget Server",
      ownerDiscordId: RECIPIENT,
      addedByDiscordId: RECIPIENT,
      memberCount: 5,
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
      outreachStage,
    },
  });
}

async function stage(): Promise<number> {
  const row = await prisma.guildInstall.findUnique({
    where: { serverId: SERVER_ID },
    select: { outreachStage: true },
  });
  return row?.outreachStage ?? -1;
}

function budgeted(client: Client, message = "hello") {
  return {
    client,
    userId: RECIPIENT,
    message,
    kind: "outreach_nudge" as const,
    guildId: SERVER_ID,
    prisma,
    budget: { guildId: SERVER_ID, serverName: "Budget Server" },
  };
}

describe("sendDM message budget", () => {
  beforeEach(async () => {
    await prisma.dmAuditLog.deleteMany();
    await prisma.guildInstall.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("appends a truthful 'message N of 3' footer", async () => {
    await seedInstall(0);
    const send = makeSendMock();

    await sendDM(budgeted(clientThatSends(send)));

    const body = String(send.mock.calls[0]?.[0]);
    expect(body).toContain("Message 1 of 3");
    expect(body).toContain("Budget Server");
  });

  it("announces the final message as final", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET - 1);
    const send = makeSendMock();

    await sendDM(budgeted(clientThatSends(send)));

    const body = String(send.mock.calls[0]?.[0]);
    expect(body).toContain("Message 3 of 3");
    expect(body).toContain("last message Scout will ever send");
  });

  it("refuses to send once the budget is spent", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET);
    const send = makeSendMock();

    const status = await sendDM(budgeted(clientThatSends(send)));

    expect(status).toBe("budget_exhausted");
    // Nothing reached Discord at all.
    expect(send).not.toHaveBeenCalled();
  });

  it("never exceeds the budget across repeated sends", async () => {
    await seedInstall(0);
    const send = makeSendMock();
    const client = clientThatSends(send);

    // Cooldown is per-recipient; clear the audit log between sends so this
    // test exercises the budget rather than the cooldown.
    for (let i = 0; i < 10; i += 1) {
      await sendDM(budgeted(client));
      await prisma.dmAuditLog.deleteMany({
        where: { deliveryStatus: "sent" },
      });
    }

    expect(await stage()).toBe(NON_CORE_MESSAGE_BUDGET);
    expect(send.mock.calls.length).toBe(NON_CORE_MESSAGE_BUDGET);
  });

  it("does not consume budget when delivery fails", async () => {
    await seedInstall(0);

    const status = await sendDM(budgeted(clientThatCannotDm()));

    expect(status).toBe("dm_disabled");
    // The bug this replaces: the old code marked the stage regardless of the
    // outcome, burning guilds that never received anything.
    expect(await stage()).toBe(0);
  });

  it("defers a second message to the same recipient within the cooldown", async () => {
    await seedInstall(0);
    const send = makeSendMock();
    const client = clientThatSends(send);

    await sendDM(budgeted(client));
    const second = await sendDM(budgeted(client));

    expect(second).toBe("deferred");
    // Deferred, not dropped, and not charged: the guild can still be messaged
    // on a later run.
    expect(await stage()).toBe(1);
    expect(send.mock.calls.length).toBe(1);
  });

  it("records every refusal in the audit log", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET);

    await sendDM(budgeted(clientThatSends(makeSendMock())));

    const rows = await prisma.dmAuditLog.findMany({
      where: { guildId: SERVER_ID },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("budget_exhausted");
  });

  it("leaves unbudgeted (core) messages untouched", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET);
    const send = makeSendMock();

    // Permission errors and competition invites are product functionality, not
    // marketing, and must never be suppressed by the onboarding budget.
    const status = await sendDM({
      client: clientThatSends(send),
      userId: RECIPIENT,
      message: "your channel permissions are broken",
      kind: "permission_error" as const,
      guildId: SERVER_ID,
      prisma,
    });

    expect(status).toBe("sent");
    expect(String(send.mock.calls[0]?.[0])).not.toContain("Message");
  });
});
