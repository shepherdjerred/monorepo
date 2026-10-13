/**
 * Non-core message budget enforcement.
 *
 * Scout tells users in the body of every message that it will send at most
 * three setup messages per server, ever. These tests are what make that a
 * guarantee rather than a claim — the budget is enforced inside `sendDM`, the
 * single chokepoint, so no caller can bypass it.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { DiscordAPIError, type Client } from "discord.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mockClient } from "#src/testing/discord-mocks.ts";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { NON_CORE_MESSAGE_BUDGET } from "#src/discord/utils/message-budget.ts";
import { reserveBudgetedDm } from "#src/discord/utils/dm-budget.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";

const { prisma } = createTestDatabase("dm-budget-test");

const SERVER_ID = testGuildId("700");
const RECIPIENT = testAccountId("42");

type SendMock = ReturnType<typeof makeSendMock>;

/** A DM send spy whose first argument is the message body. */
function makeSendMock() {
  return vi.fn((_body: unknown) => Promise.resolve({}));
}

/** A Discord client whose DMs always succeed. */
function clientThatSends(send: SendMock) {
  return mockClient({
    users: {
      fetch: vi.fn(() => Promise.resolve({ tag: "tester#0001", send })),
    },
  });
}

/** A Discord client that rejects DMs the way a closed-DM recipient does. */
function clientThatCannotDm() {
  return mockClient({
    users: {
      fetch: vi.fn(() =>
        Promise.resolve({
          tag: "tester#0001",
          send: vi.fn(() =>
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

const INSTALLED_AT = new Date("2026-01-01T00:00:00.000Z");

/**
 * Seed an install plus `delivered` prior deliveries. Spend lives in the audit
 * log now, so "already spent N" means N recorded sent rows — the same rows the
 * gate reads.
 */
async function seedInstall(delivered = 0): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Budget Server",
      ownerDiscordId: RECIPIENT,
      addedByDiscordId: RECIPIENT,
      memberCount: 5,
      installedAt: INSTALLED_AT,
    },
  });
  for (let i = 0; i < delivered; i += 1) {
    await prisma.dmAuditLog.create({
      data: {
        // A different recipient, so these don't trip the per-recipient cooldown.
        recipientId: testAccountId("99"),
        guildId: SERVER_ID,
        kind: "outreach_nudge",
        content: "prior",
        deliveryStatus: "sent",
        ladderStage: i + 1,
      },
    });
  }
}

async function spent(): Promise<number> {
  return prisma.dmAuditLog.count({
    where: {
      guildId: SERVER_ID,
      deliveryStatus: "sent",
      kind: {
        in: ["outreach_nudge", "outreach_last_call", "feedback_request"],
      },
    },
  });
}

function budgeted(client: Client, message = "hello") {
  return {
    client,
    userId: RECIPIENT,
    message,
    kind: "outreach_nudge" as const,
    guildId: SERVER_ID,
    prisma,
    budget: {
      guildId: SERVER_ID,
      serverName: "Budget Server",
      installedAt: INSTALLED_AT,
    },
  };
}

beforeEach(async () => {
  await prisma.dmAuditLog.deleteMany();
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendDM message budget", () => {
  it("appends a truthful 'message N of 3' footer", async () => {
    await seedInstall(0);
    const send = makeSendMock();

    await sendDM(budgeted(clientThatSends(send)));

    const body = String(send.mock.calls[0]?.[0]);
    expect(body).toContain("1 of 3");
    expect(body).toContain("Budget Server");
  });

  it("keeps the final message short", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET - 1);
    const send = makeSendMock();

    await sendDM(budgeted(clientThatSends(send)));

    const body = String(send.mock.calls[0]?.[0]);
    expect(body).toContain("3 of 3");
    expect(body).not.toContain("last message Scout will ever send");
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

    // Reassign delivered rows to another recipient between sends. The cooldown
    // is per-recipient and the budget is per-guild, so this clears the cooldown
    // while leaving the ledger intact — backdating them instead would push them
    // outside the install window and hide them from the budget entirely.
    for (let i = 0; i < 10; i += 1) {
      await sendDM(budgeted(client));
      await prisma.dmAuditLog.updateMany({
        where: { recipientId: RECIPIENT, deliveryStatus: "sent" },
        data: { recipientId: testAccountId("98") },
      });
    }

    expect(await spent()).toBe(NON_CORE_MESSAGE_BUDGET);
    expect(send.mock.calls.length).toBe(NON_CORE_MESSAGE_BUDGET);
  });

  it("does not consume budget when delivery fails", async () => {
    await seedInstall(0);

    const status = await sendDM(budgeted(clientThatCannotDm()));

    expect(status).toBe("dm_disabled");
    // The bug this replaces: the old code marked the stage regardless of the
    // outcome, burning guilds that never received anything.
    expect(await spent()).toBe(0);
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
    expect(await spent()).toBe(1);
    expect(send.mock.calls.length).toBe(1);
  });

  it("defers across kinds, not just outreach-prefixed ones", async () => {
    await seedInstall(0);
    const send = makeSendMock();
    const client = clientThatSends(send);

    // An installer with several configured servers gets `feedback_request` for
    // each. Matching the cooldown on the `outreach` prefix alone let all of
    // them go out at once — the exact burst the 72h spacing prevents.
    await sendDM({ ...budgeted(client), kind: "feedback_request" as const });
    const second = await sendDM({
      ...budgeted(client),
      kind: "feedback_request" as const,
    });

    expect(second).toBe("deferred");
    expect(send.mock.calls.length).toBe(1);
  });

  it("holds the cap under concurrent sends", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET - 1);
    const send = makeSendMock();
    const client = clientThatSends(send);

    // The outreach cron and a guildDelete handler can run at once. Without
    // serializing the read-decide-write sequence, both would observe two
    // messages spent, both would be allowed, and both would deliver a
    // "Message 3 of 3" — four in total, breaking the printed promise.
    const results = await Promise.all([
      sendDM({ ...budgeted(client), kind: "feedback_request" as const }),
      sendDM({ ...budgeted(client), kind: "feedback_request" as const }),
    ]);

    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(await spent()).toBe(NON_CORE_MESSAGE_BUDGET);
    expect(send.mock.calls.length).toBe(1);
  });

  it("never leaves a delivered message unaccounted", async () => {
    await seedInstall(0);
    const send = makeSendMock();

    await sendDM(budgeted(clientThatSends(send)));

    // The ledger row is reserved BEFORE Discord is contacted, so there is no
    // window where a message is delivered but unrecorded — which would let the
    // same rung and message number go out again.
    expect(await spent()).toBe(1);
    expect(send.mock.calls.length).toBe(1);
  });

  it("releases the reservation when delivery bounces", async () => {
    await seedInstall(0);

    const status = await sendDM(budgeted(clientThatCannotDm()));

    expect(status).toBe("dm_disabled");
    // Reserved then downgraded: a bounced DM must charge nothing.
    expect(await spent()).toBe(0);
    const rows = await prisma.dmAuditLog.findMany({
      where: { guildId: SERVER_ID },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("dm_disabled");
  });

  it("records every refusal in the audit log", async () => {
    await seedInstall(NON_CORE_MESSAGE_BUDGET);

    await sendDM(budgeted(clientThatSends(makeSendMock())));

    const rows = await prisma.dmAuditLog.findMany({
      where: { guildId: SERVER_ID, deliveryStatus: "budget_exhausted" },
    });
    expect(rows).toHaveLength(1);
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

describe("sendDM reservation ownership", () => {
  it("releases a direct send's failed lookup so the ladder and cooldown can retry", async () => {
    await seedInstall();
    const client = mockClient({
      users: {
        fetch: vi.fn(() => Promise.reject(new Error("Lookup unavailable"))),
      },
    });
    const options = budgeted(client);
    const failed = await sendDM({
      ...options,
      budget: { ...options.budget, ladderStage: 1 },
    });
    expect(failed).toBe("failed");
    const failedRow = await prisma.dmAuditLog.findFirstOrThrow();
    expect(failedRow.deliveryStatus).toBe("failed");
    expect(await readOutreachState(prisma, SERVER_ID, INSTALLED_AT)).toEqual({
      spent: 0,
      lastLadderStage: 0,
      feedbackRequested: false,
    });
    const send = makeSendMock();
    expect(await sendDM(budgeted(clientThatSends(send)))).toBe("sent");
    expect(String(send.mock.calls[0]?.[0])).toContain("1 of 3");
  });

  it("retains a durable reservation across a failed lookup and retries that same row", async () => {
    await seedInstall();
    const send = makeSendMock();
    const client = clientThatSends(send);
    const fetch = vi.spyOn(client.users, "fetch");
    fetch.mockRejectedValueOnce(new Error("Lookup unavailable"));
    const { budget, ...options } = budgeted(client);
    const reservation = await prisma.$transaction(
      async (tx) =>
        await reserveBudgetedDm(tx, {
          recipientId: RECIPIENT,
          guildId: SERVER_ID,
          kind: options.kind,
          message: options.message,
          budget,
        }),
    );
    if (reservation.status !== "reserved")
      throw new Error("Expected reservation");
    const delivery = {
      ...options,
      message: reservation.message,
      reservationId: reservation.id,
    };
    expect(await sendDM(delivery)).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    const reservedRow = await prisma.dmAuditLog.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(reservedRow.deliveryStatus).toBe("reserved");
    const reservedState = await readOutreachState(
      prisma,
      SERVER_ID,
      INSTALLED_AT,
    );
    expect(reservedState.spent).toBe(1);
    expect(await sendDM(delivery)).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    expect(await prisma.dmAuditLog.count()).toBe(1);
    const sentRow = await prisma.dmAuditLog.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(sentRow.deliveryStatus).toBe("sent");
  });

  it("keeps an uncertain direct send charged and prevents an automatic resend", async () => {
    await seedInstall();
    const send = makeSendMock();
    send.mockRejectedValueOnce(new Error("Send acknowledgment lost"));
    const options = budgeted(clientThatSends(send));
    expect(await sendDM(options)).toBe("unknown");
    const unknownRow = await prisma.dmAuditLog.findFirstOrThrow();
    expect(unknownRow.deliveryStatus).toBe("unknown");
    const unknownState = await readOutreachState(
      prisma,
      SERVER_ID,
      INSTALLED_AT,
    );
    expect(unknownState.spent).toBe(1);
    expect(await sendDM(options)).toBe("deferred");
    expect(send).toHaveBeenCalledOnce();
  });
});
