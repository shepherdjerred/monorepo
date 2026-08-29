import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { buildBalanceChartAttachment } from "#src/betting/balance-chart.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-balance-chart");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const USER = bucksTestDiscordId(1);

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("buildBalanceChartAttachment", () => {
  test("renders a PNG for a wallet with history", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: USER, balance: 25 },
    });
    for (const [index, balanceAfter] of [20, 26, 25].entries()) {
      await db.bucksLedgerEntry.create({
        data: {
          bucksAccountId: account.id,
          delta: 1,
          balanceAfter,
          kind: "adjustment",
          context: JSON.stringify({
            type: "adjustment",
            note: "test",
            actorDiscordId: USER,
          }),
          createdAt: new Date(Date.UTC(2030, 0, index + 1)),
        },
      });
    }

    const attachment = await buildBalanceChartAttachment(
      { serverId: SERVER_ID, discordId: USER },
      db,
    );
    expect(attachment).not.toBeNull();
    expect(attachment?.name).toBe("bryan-bucks-balance.png");
    // PNG magic bytes prove a real render, not an empty buffer.
    const data = attachment?.attachment;
    if (!Buffer.isBuffer(data)) {
      throw new TypeError("expected a Buffer attachment");
    }
    expect([...data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("draws nothing for a missing wallet or a single ledger row", async () => {
    await expect(
      buildBalanceChartAttachment({ serverId: SERVER_ID, discordId: USER }, db),
    ).resolves.toBeNull();

    const account = await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: USER, balance: 20 },
    });
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 20,
        balanceAfter: 20,
        kind: "seed",
        context: JSON.stringify({ type: "seed", note: "welcome" }),
      },
    });
    await expect(
      buildBalanceChartAttachment({ serverId: SERVER_ID, discordId: USER }, db),
    ).resolves.toBeNull();
  });
});
