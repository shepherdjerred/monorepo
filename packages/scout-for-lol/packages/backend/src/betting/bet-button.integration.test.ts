import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  bucksTestDiscordId,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import {
  handleBetButton,
  type BetButtonInteraction,
} from "#src/betting/bet-button.ts";
import { formatBucksCustomId } from "#src/betting/custom-id.ts";
import { buildBettingRows } from "#src/betting/components.ts";
import { SEED_GRANT } from "#src/betting/constants.ts";

const { prisma: db } = createTestDatabase("bucks-bet-button");

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const BETTOR = bucksTestDiscordId(1);
const MATCH_ID = "NA1_5000000042";

/**
 * A stand-in for discord.js's ButtonInteraction.
 *
 * The handler's parameter type is structural precisely so this can be a plain
 * object: the real ButtonInteraction satisfies it, and a test needs no `as`
 * cast and no mock framework to build one.
 */
function fakeInteraction(customId: string, guildId: string | null = SERVER_ID) {
  const replies: string[] = [];
  const interaction: BetButtonInteraction = {
    customId,
    guildId,
    user: { id: BETTOR },
    deferReply: mock(() => Promise.resolve(undefined)),
    editReply: mock((options: { content: string }) => {
      replies.push(options.content);
      return Promise.resolve(undefined);
    }),
  };
  return { interaction, replies };
}

function betId(subjectIndex: number, side: "W" | "L", amount: number) {
  return formatBucksCustomId({
    action: "b",
    matchId: MATCH_ID,
    subjectIndex,
    side,
    amount,
  });
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.player.deleteMany();
}

beforeEach(async () => {
  await clearAll();
  const now = new Date();
  await db.player.create({
    data: {
      alias: "jerred",
      discordId: BETTOR,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
    },
  });
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("handleBetButton", () => {
  test("places a bet from a button click", async () => {
    const { interaction, replies } = fakeInteraction(betId(0, "W", 5));
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("Bet placed");
    expect(replies[0]).toContain("jerred WINS");
    expect(await db.bucksBet.count()).toBe(1);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT - 5);
  });

  test("a LOSE button backs the opposing team", async () => {
    const { interaction, replies } = fakeInteraction(betId(0, "L", 1));
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("jerred LOSES");
    const bet = await db.bucksBet.findFirstOrThrow();
    // Subject index 0 is on team 100, so betting it loses backs team 200.
    expect(bet.predictedTeamId).toBe(200);
  });

  test("cancels a position and refunds it", async () => {
    await handleBetButton(fakeInteraction(betId(0, "W", 5)).interaction, db);

    const cancelId = formatBucksCustomId({
      action: "x",
      matchId: MATCH_ID,
      subjectIndex: 0,
      side: "W",
      amount: 0,
    });
    const { interaction, replies } = fakeInteraction(cancelId);
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("Bet cancelled");
    expect(await db.bucksBet.count()).toBe(0);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT);
  });

  test("cancelling frees the slot so the other side can be backed", async () => {
    await handleBetButton(fakeInteraction(betId(0, "W", 5)).interaction, db);
    const cancelId = formatBucksCustomId({
      action: "x",
      matchId: MATCH_ID,
      subjectIndex: 0,
      side: "W",
      amount: 0,
    });
    await handleBetButton(fakeInteraction(cancelId).interaction, db);

    const { replies } = await (async () => {
      const f = fakeInteraction(betId(0, "L", 5));
      await handleBetButton(f.interaction, db);
      return f;
    })();

    expect(replies[0]).toContain("Bet placed");
    const bet = await db.bucksBet.findFirstOrThrow();
    expect(bet.predictedTeamId).toBe(200);
  });

  test("tells a bettor their position is locked rather than missing", async () => {
    await handleBetButton(fakeInteraction(betId(0, "W", 5)).interaction, db);
    await db.bucksMatchPool.updateMany({
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    const cancelId = formatBucksCustomId({
      action: "x",
      matchId: MATCH_ID,
      subjectIndex: 0,
      side: "W",
      amount: 0,
    });
    const { interaction, replies } = fakeInteraction(cancelId);
    await handleBetButton(interaction, db);

    // "You don't have a bet" would be a lie to someone whose stake is sitting
    // in the pool, and would read as if it had never been recorded.
    expect(replies[0]).toContain("Betting has closed");
    expect(replies[0]).not.toContain("don't have a bet");

    // The stake stays staked: no refund sneaks out after close.
    expect(await db.bucksBet.count()).toBe(1);
    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT - 5);
  });

  test("still reports a missing bet as missing", async () => {
    const cancelId = formatBucksCustomId({
      action: "x",
      matchId: MATCH_ID,
      subjectIndex: 0,
      side: "W",
      amount: 0,
    });
    const { interaction, replies } = fakeInteraction(cancelId);
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("don't have a bet");
  });

  test("refuses a click after the window closes", async () => {
    await db.bucksMatchPool.updateMany({
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    const { interaction, replies } = fakeInteraction(betId(0, "W", 5));
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("Betting has closed");
    expect(await db.bucksBet.count()).toBe(0);
  });

  test("ignores a custom ID it does not recognise", async () => {
    const { interaction, replies } = fakeInteraction("something:else:entirely");
    await handleBetButton(interaction, db);

    // Silent by design: an unauthenticated surface should not answer garbage.
    expect(replies).toEqual([]);
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test("refuses a click outside a guild", async () => {
    const { interaction, replies } = fakeInteraction(betId(0, "W", 5), null);
    await handleBetButton(interaction, db);
    expect(replies[0]).toContain("only works inside a server");
  });

  test("tells an unlinked user how to become eligible", async () => {
    await db.player.deleteMany();
    const { interaction, replies } = fakeInteraction(betId(0, "W", 5));
    await handleBetButton(interaction, db);

    expect(replies[0]).toContain("Only tracked players can bet");
    expect(await db.bucksAccount.count()).toBe(0);
  });
});

describe("buildBettingRows", () => {
  test("builds one row of five components per tracked player", () => {
    const rows = buildBettingRows({
      matchId: MATCH_ID,
      roster: bucksTestRoster(),
    });

    // The fixture tracks two players, on opposite teams.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Discord's per-row cap, which is what fixes the stake denominations.
      expect(row.components).toHaveLength(5);
    }
  });

  test("every button carries a parseable, in-range custom ID", () => {
    const rows = buildBettingRows({
      matchId: "EUW1_1234567890123",
      roster: bucksTestRoster(),
    });

    for (const row of rows) {
      for (const button of row.components) {
        const json = button.toJSON();
        if (!("custom_id" in json)) {
          throw new Error("every betting component should carry a custom id");
        }
        expect(json.custom_id.length).toBeLessThanOrEqual(100);
      }
    }
  });

  test("produces nothing when nobody in the game is tracked", () => {
    const untracked = bucksTestRoster().map((participant) => ({
      ...participant,
      trackedAlias: undefined,
    }));
    expect(buildBettingRows({ matchId: MATCH_ID, roster: untracked })).toEqual(
      [],
    );
  });
});
