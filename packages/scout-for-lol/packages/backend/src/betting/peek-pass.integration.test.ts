import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import {
  PEEK_PASS_DURATION_MS,
  PEEK_PASS_QUOTE_TTL_MS,
  purchasePeekPass,
  quotePeekPass,
} from "#src/betting/peek-pass.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-peek-pass");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const USER_ID = bucksTestDiscordId(1);
const NOW = new Date("2026-08-19T00:00:00Z");

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

async function createWallet(balance: number, createdAt = NOW): Promise<number> {
  const account = await db.bucksAccount.create({
    data: { serverId: SERVER_ID, discordId: USER_ID, balance },
  });
  if (balance > 0) {
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: balance,
        balanceAfter: balance,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "test wallet" }),
        createdAt,
      },
    });
  }
  return account.id;
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("peek-pass purchase", () => {
  test("refuses a missing wallet, a sub-floor balance, and an active pass", async () => {
    expect(
      await quotePeekPass(
        { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
        db,
      ),
    ).toEqual({ kind: "no_wallet" });
    const accountId = await createWallet(4);
    expect(
      await quotePeekPass(
        { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
        db,
      ),
    ).toEqual({ kind: "insufficient", balance: 4 });
    const expiresAt = new Date(NOW.getTime() + 60_000);
    await db.bucksAccount.update({
      where: { id: accountId },
      data: { balance: 5, peekPassExpiresAt: expiresAt },
    });
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: accountId,
        delta: 1,
        balanceAfter: 5,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "test" }),
      },
    });
    expect(
      await quotePeekPass(
        { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
        db,
      ),
    ).toEqual({ kind: "active", expiresAt });
  });

  test("conserves Bucks between the purchaser and house in one transaction", async () => {
    await createWallet(100);
    await db.$transaction(async (tx) => {
      await ensureHouseAccountInTransaction(tx, SERVER_ID);
    });
    const quote = await quotePeekPass(
      { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
      db,
    );
    if (quote.kind !== "quoted") {
      throw new Error("expected quote");
    }
    const before = await db.bucksAccount.aggregate({
      where: { serverId: SERVER_ID },
      _sum: { balance: true },
    });
    const purchased = await purchasePeekPass(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        quotedAt: quote.quotedAt,
        quotedPrice: quote.quote.price,
        now: NOW,
      },
      db,
    );
    expect(purchased).toEqual({
      kind: "purchased",
      price: 10,
      balanceAfter: 90,
      expiresAt: new Date(NOW.getTime() + PEEK_PASS_DURATION_MS),
    });
    const after = await db.bucksAccount.aggregate({
      where: { serverId: SERVER_ID },
      _sum: { balance: true },
    });
    expect(after._sum.balance).toBe(before._sum.balance);
    const entries = await db.bucksLedgerEntry.findMany({
      where: { kind: "peek_pass" },
      orderBy: { id: "asc" },
    });
    expect(entries.map((entry) => entry.delta)).toEqual([-10, 10]);
    expect(entries.map((entry) => JSON.parse(entry.context))).toEqual([
      expect.objectContaining({ type: "peek_pass", price: 10 }),
      expect.objectContaining({ type: "peek_pass", price: 10 }),
    ]);
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(10_010);
  });

  test("rolls back stale and changed quotes without charging", async () => {
    const accountId = await createWallet(100);
    const quote = await quotePeekPass(
      { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
      db,
    );
    if (quote.kind !== "quoted") {
      throw new Error("expected quote");
    }
    const stale = await purchasePeekPass(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        quotedAt: quote.quotedAt,
        quotedPrice: quote.quote.price,
        now: new Date(NOW.getTime() + PEEK_PASS_QUOTE_TTL_MS),
      },
      db,
    );
    expect(stale.kind).toBe("quote_changed");
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: accountId } }),
    ).toEqual(
      expect.objectContaining({ balance: 100, peekPassExpiresAt: null }),
    );

    await db.$transaction(async (tx) => {
      await applyBucksDelta(tx, {
        bucksAccountId: accountId,
        delta: 100,
        kind: "adjustment",
        context: {
          type: "adjustment",
          note: "changes quoted balance",
          actorDiscordId: USER_ID,
        },
      });
    });
    const changed = await purchasePeekPass(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        quotedAt: quote.quotedAt,
        quotedPrice: quote.quote.price,
        now: NOW,
      },
      db,
    );
    expect(changed).toEqual(
      expect.objectContaining({
        kind: "quote_changed",
        quote: expect.objectContaining({ balance: 200, price: 20 }),
      }),
    );
  });

  test("only one concurrent confirmation can buy the pass", async () => {
    await createWallet(100);
    const quote = await quotePeekPass(
      { serverId: SERVER_ID, discordId: USER_ID, now: NOW },
      db,
    );
    if (quote.kind !== "quoted") {
      throw new Error("expected quote");
    }
    const confirm = () =>
      purchasePeekPass(
        {
          serverId: SERVER_ID,
          discordId: USER_ID,
          quotedAt: quote.quotedAt,
          quotedPrice: quote.quote.price,
          now: NOW,
        },
        db,
      );
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.map((result) => result.kind).toSorted()).toEqual([
      "active",
      "purchased",
    ]);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "peek_pass" } }),
    ).toBe(2);
  });

  test("allows a new quote once the previous pass expires", async () => {
    await createWallet(100);
    await db.bucksAccount.update({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: USER_ID },
      },
      data: { peekPassExpiresAt: NOW },
    });
    const renewed = await quotePeekPass(
      {
        serverId: SERVER_ID,
        discordId: USER_ID,
        now: new Date(NOW.getTime() + 1),
      },
      db,
    );
    expect(renewed.kind).toBe("quoted");
  });
});
