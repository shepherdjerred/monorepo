import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import { transferBucks } from "#src/betting/transfer.ts";
import type { isPolicyEnabled } from "#src/configuration/flags.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-transfer");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const OTHER_SERVER = DiscordGuildIdSchema.parse("2337623164146155593");
const SENDER = bucksTestDiscordId(81);
const RECIPIENT = bucksTestDiscordId(82);
const OTHER_RECIPIENT = bucksTestDiscordId(83);
const TRANSFER_ID = "df505f9c-0f98-45e5-9e32-cf5e2b6eb2e0";

const enabled: typeof isPolicyEnabled = () => Promise.resolve(true);

async function createWallet(input: {
  serverId?: DiscordGuildId;
  discordId: DiscordAccountId;
  balance: number;
  isHouse?: boolean;
}): Promise<number> {
  const account = await db.bucksAccount.create({
    data: {
      serverId: input.serverId ?? SERVER,
      discordId: input.discordId,
      balance: input.balance,
      isHouse: input.isHouse ?? false,
    },
  });
  if (input.balance > 0) {
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: input.balance,
        balanceAfter: input.balance,
        kind: "adjustment",
        context: JSON.stringify({
          type: "adjustment",
          note: "test wallet",
          actorDiscordId: SENDER,
        }),
      },
    });
  }
  return account.id;
}

async function createStandardWallets(senderBalance = 10): Promise<{
  senderId: number;
  recipientId: number;
  houseId: number;
}> {
  const senderId = await createWallet({
    discordId: SENDER,
    balance: senderBalance,
  });
  const recipientId = await createWallet({
    discordId: RECIPIENT,
    balance: 4,
  });
  const houseId = await createWallet({
    discordId: HOUSE_ACCOUNT_DISCORD_ID,
    balance: 100,
    isHouse: true,
  });
  return { senderId, recipientId, houseId };
}

function runTransfer(input: {
  senderDiscordId?: DiscordAccountId;
  recipientDiscordId?: DiscordAccountId;
  recipientIsBot?: boolean;
  amount?: number;
  serverId?: DiscordGuildId;
  isEnabled?: typeof isPolicyEnabled;
}) {
  return transferBucks(
    {
      serverId: input.serverId ?? SERVER,
      senderDiscordId: input.senderDiscordId ?? SENDER,
      recipientDiscordId: input.recipientDiscordId ?? RECIPIENT,
      recipientIsBot: input.recipientIsBot ?? false,
      amount: input.amount ?? 3,
    },
    {
      prismaClient: db,
      isPolicyEnabled: input.isEnabled ?? enabled,
      createTransferId: () => TRANSFER_ID,
    },
  );
}

beforeEach(async () => {
  await db.bucksAnalyticsLedgerOutbox.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
});

afterAll(async () => {
  await db.bucksAccount.deleteMany();
  await db.$disconnect();
});

describe("transferBucks", () => {
  test("writes three correlated ledger and outbox rows while conserving balances", async () => {
    const accounts = await createStandardWallets();
    const before = await db.bucksAccount.aggregate({
      where: { serverId: SERVER },
      _sum: { balance: true },
    });

    await expect(runTransfer({ amount: 3 })).resolves.toEqual({
      kind: "transferred",
      transferId: TRANSFER_ID,
      totalAmount: 3,
      recipientAmount: 1,
      feeAmount: 2,
      balanceAfter: 7,
    });

    const balances = await db.bucksAccount.findMany({
      where: { id: { in: Object.values(accounts) } },
      orderBy: { id: "asc" },
      select: { balance: true },
    });
    expect(balances.map((account) => account.balance)).toEqual([7, 5, 102]);
    const entries = await db.bucksLedgerEntry.findMany({
      where: { kind: { startsWith: "transfer_" } },
      orderBy: { id: "asc" },
    });
    expect(entries.map((entry) => [entry.kind, entry.delta])).toEqual([
      ["transfer_sent", -3],
      ["transfer_received", 1],
      ["transfer_fee", 2],
    ]);
    const contexts = entries.map((entry) =>
      BucksLedgerContextSchema.parse(JSON.parse(entry.context)),
    );
    expect(contexts.map((context) => context.type)).toEqual([
      "transfer",
      "transfer",
      "transfer",
    ]);
    expect(contexts).toEqual(
      expect.arrayContaining([
        {
          type: "transfer",
          transferId: TRANSFER_ID,
          senderAccountId: accounts.senderId,
          recipientAccountId: accounts.recipientId,
          houseAccountId: accounts.houseId,
          totalAmount: 3,
          recipientAmount: 1,
          feeAmount: 2,
          role: "sender",
        },
        {
          type: "transfer",
          transferId: TRANSFER_ID,
          senderAccountId: accounts.senderId,
          recipientAccountId: accounts.recipientId,
          houseAccountId: accounts.houseId,
          totalAmount: 3,
          recipientAmount: 1,
          feeAmount: 2,
          role: "recipient",
        },
        {
          type: "transfer",
          transferId: TRANSFER_ID,
          senderAccountId: accounts.senderId,
          recipientAccountId: accounts.recipientId,
          houseAccountId: accounts.houseId,
          totalAmount: 3,
          recipientAmount: 1,
          feeAmount: 2,
          role: "house",
        },
      ]),
    );
    expect(entries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(0);
    expect(await db.bucksAnalyticsLedgerOutbox.count()).toBe(3);
    const after = await db.bucksAccount.aggregate({
      where: { serverId: SERVER },
      _sum: { balance: true },
    });
    expect(after._sum.balance).toBe(before._sum.balance);
  });

  test("rejects insufficient funds without any movement", async () => {
    await createStandardWallets(2);
    await expect(runTransfer({ amount: 3 })).resolves.toEqual({
      kind: "insufficient",
      balance: 2,
      needed: 3,
    });
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "transfer_" } },
      }),
    ).toBe(0);
  });

  test("requires both existing wallets in the same guild", async () => {
    await createWallet({
      serverId: OTHER_SERVER,
      discordId: RECIPIENT,
      balance: 4,
    });
    await createWallet({ discordId: SENDER, balance: 10 });
    await createWallet({
      discordId: HOUSE_ACCOUNT_DISCORD_ID,
      balance: 100,
      isHouse: true,
    });
    await expect(runTransfer({})).resolves.toEqual({
      kind: "recipient_not_found",
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: {
          serverId_discordId: {
            serverId: OTHER_SERVER,
            discordId: RECIPIENT,
          },
        },
      }),
    ).toEqual(expect.objectContaining({ balance: 4 }));

    await db.bucksAccount.delete({
      where: { serverId_discordId: { serverId: SERVER, discordId: SENDER } },
    });
    await expect(runTransfer({})).resolves.toEqual({
      kind: "sender_not_found",
    });
  });
});

describe("transferBucks policy and transaction safety", () => {
  test("rejects self, bot, and house recipients", async () => {
    await createStandardWallets();
    await expect(runTransfer({ recipientDiscordId: SENDER })).resolves.toEqual({
      kind: "same_user",
    });
    await expect(runTransfer({ recipientIsBot: true })).resolves.toEqual({
      kind: "recipient_bot",
    });
    await expect(
      runTransfer({ recipientDiscordId: HOUSE_ACCOUNT_DISCORD_ID }),
    ).resolves.toEqual({ kind: "recipient_is_house" });
  });

  test("rejects a house wallet acting as the sender", async () => {
    await createStandardWallets();
    await db.bucksAccount.update({
      where: { serverId_discordId: { serverId: SERVER, discordId: SENDER } },
      data: { isHouse: true },
    });
    await expect(runTransfer({})).resolves.toEqual({
      kind: "sender_not_found",
    });
  });

  test("rolls back the sender debit and recipient credit when the house credit overflows", async () => {
    const { senderId, recipientId } = await createStandardWallets();
    await db.bucksAccount.update({
      where: {
        serverId_discordId: {
          serverId: SERVER,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
      data: { balance: BUCKS_INT32_MAX },
    });
    await expect(runTransfer({ amount: 2 })).resolves.toEqual({
      kind: "storage_limit",
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: senderId } }),
    ).toEqual(expect.objectContaining({ balance: 10 }));
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: recipientId } }),
    ).toEqual(expect.objectContaining({ balance: 4 }));
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "transfer_" } },
      }),
    ).toBe(0);
  });

  test("honors flag revocation at the domain boundary", async () => {
    await createStandardWallets();
    const calls: string[] = [];
    const isEnabled: typeof isPolicyEnabled = (name) => {
      calls.push(name);
      return Promise.resolve(name === "betting_enabled");
    };
    await expect(runTransfer({ isEnabled })).resolves.toEqual({
      kind: "feature_disabled",
    });
    expect(calls.toSorted()).toEqual([
      "betting_enabled",
      "bucks_transfers_enabled",
    ]);
  });

  test("serializes concurrent debits so only one can spend", async () => {
    await createStandardWallets(3);
    await createWallet({ discordId: OTHER_RECIPIENT, balance: 1 });
    const results = await Promise.all([
      runTransfer({ amount: 2 }),
      runTransfer({ recipientDiscordId: OTHER_RECIPIENT, amount: 2 }),
    ]);
    expect(results.map((result) => result.kind).toSorted()).toEqual([
      "insufficient",
      "transferred",
    ]);
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "transfer_" } },
      }),
    ).toBe(3);
  });
});
