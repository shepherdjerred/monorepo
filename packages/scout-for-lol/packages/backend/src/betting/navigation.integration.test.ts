import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  formatBucksNavigationId,
  handleBucksNavigation,
  parseBucksNavigationId,
  type BucksNavigationInteraction,
} from "#src/betting/navigation.ts";
import type { BucksButtonEditReplyOptions } from "#src/betting/bet-button.ts";
import { getLedgerPage } from "#src/betting/accounts.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-navigation");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const OWNER_ID = bucksTestDiscordId(1);
const OTHER_ID = bucksTestDiscordId(2);

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

function fakeNavigation(customId: string, userId = OWNER_ID) {
  const calls: string[] = [];
  const replies: BucksButtonEditReplyOptions[] = [];
  const interaction: BucksNavigationInteraction = {
    customId,
    guildId: SERVER_ID,
    user: { id: userId },
    deferReply: vi.fn(() => {
      calls.push("deferReply");
      return Promise.resolve(undefined);
    }),
    deferUpdate: vi.fn(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    editReply: vi.fn((options: BucksButtonEditReplyOptions) => {
      calls.push("editReply");
      replies.push(options);
      return Promise.resolve(undefined);
    }),
  };
  return { interaction, calls, replies };
}

async function createHistory(count: number) {
  const account = await db.bucksAccount.create({
    data: { serverId: SERVER_ID, discordId: OWNER_ID, balance: count },
  });
  for (let index = 1; index <= count; index++) {
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 1,
        balanceAfter: index,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "test" }),
      },
    });
  }
  return account;
}

describe("Bryan Bucks history navigation", () => {
  test("round-trips the versioned caller-bound ID", () => {
    const input = {
      action: "h" as const,
      ownerId: OWNER_ID,
      snapshotId: 123,
      page: 2,
    };
    expect(parseBucksNavigationId(formatBucksNavigationId(input))).toEqual(
      input,
    );
  });

  test("rejects a click from anyone except the original caller", async () => {
    await createHistory(12);
    const first = await getLedgerPage(
      { serverId: SERVER_ID, discordId: OWNER_ID, page: 0 },
      db,
    );
    if (first.snapshotId === null) {
      throw new Error("The populated ledger did not produce a snapshot ID");
    }
    const { interaction, calls, replies } = fakeNavigation(
      formatBucksNavigationId({
        action: "h",
        ownerId: OWNER_ID,
        snapshotId: first.snapshotId,
        page: 1,
      }),
      OTHER_ID,
    );

    await handleBucksNavigation(interaction, db);

    expect(calls).toEqual(["deferReply", "editReply"]);
    expect(replies[0]?.content).toContain("Only the person");
    expect(replies[0]?.content).not.toContain("BB history");
  });

  test("loads the requested frozen page for its owner", async () => {
    const account = await createHistory(12);
    const first = await getLedgerPage(
      { serverId: SERVER_ID, discordId: OWNER_ID, page: 0 },
      db,
    );
    if (first.snapshotId === null) {
      throw new Error("The populated ledger did not produce a snapshot ID");
    }
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 50,
        balanceAfter: 62,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "new" }),
      },
    });
    const { interaction, calls, replies } = fakeNavigation(
      formatBucksNavigationId({
        action: "h",
        ownerId: OWNER_ID,
        snapshotId: first.snapshotId,
        page: 1,
      }),
    );

    await handleBucksNavigation(interaction, db);

    expect(calls).toEqual(["deferUpdate", "editReply"]);
    expect(replies[0]?.content).toContain("Page 2/2");
    expect(replies[0]?.content).toContain("→ 2 BB");
    expect(replies[0]?.content).toContain("→ 1 BB");
    expect(replies[0]?.content).not.toContain("→ 62 BB");
  });
});
