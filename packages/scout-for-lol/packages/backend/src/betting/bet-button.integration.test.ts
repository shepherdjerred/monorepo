import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ButtonStyle } from "discord.js";
import {
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  bucksTestDiscordId,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import {
  handleBetButton,
  type BetButtonDependencies,
  type BetButtonInteraction,
} from "#src/betting/bet-button.ts";
import {
  formatBucksCustomId,
  parseBucksCustomId,
} from "#src/betting/custom-id.ts";
import { buildBettingRows } from "#src/betting/components.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  SEED_GRANT,
} from "#src/betting/constants.ts";

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

function recordingRefreshes(
  calls: { matchId: string; serverId: string }[],
): BetButtonDependencies {
  return {
    refreshMessages: (input) => {
      calls.push(input);
      return Promise.resolve();
    },
  };
}

function buttonIdForLabel(
  roster: readonly BucksPoolParticipant[],
  label: string,
): string {
  const row = buildBettingRows({ matchId: MATCH_ID, roster })[0];
  if (row === undefined) {
    throw new Error("expected a betting row");
  }
  const button = row.components.find((candidate) => {
    const candidateJson = candidate.toJSON();
    return "label" in candidateJson && candidateJson.label === label;
  });
  if (button === undefined) {
    throw new Error(`expected a ${label} button`);
  }
  const json = button.toJSON();
  if (!("custom_id" in json)) {
    throw new Error("team betting buttons must carry a custom id");
  }
  return json.custom_id;
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
  test.each([
    ["Blue · 1 BB", 100, 1, "Blue Team"],
    ["Blue · 5 BB", 100, 5, "Blue Team"],
    ["Red · 1 BB", 200, 1, "Red Team"],
    ["Red · 5 BB", 200, 5, "Red Team"],
  ])(
    "%s places a direct team bet",
    async (label, expectedTeamId, expectedStake, expectedTeamName) => {
      const customId = buttonIdForLabel(bucksTestRoster(), label);
      const { interaction, replies } = fakeInteraction(customId);
      await handleBetButton(interaction, db);

      expect(replies[0]).toContain("Bet placed");
      expect(replies[0]).toContain(expectedTeamName);
      expect(replies[0]).not.toContain("jerred WINS");
      expect(replies[0]).toContain(
        "winning payouts, rounded to the nearest BB",
      );
      expect(replies[0]).toContain("Winning principal is protected");
      expect(replies[0]).toContain(
        "Cancelling an outcome position costs **20%**, also rounded to the nearest BB",
      );
      expect(await db.bucksBet.count()).toBe(1);
      const bet = await db.bucksBet.findFirstOrThrow();
      expect(bet.predictedTeamId).toBe(expectedTeamId);
      expect(bet.stake).toBe(expectedStake);

      const account = await db.bucksAccount.findFirstOrThrow({
        where: { isHouse: false },
      });
      expect(account.balance).toBe(SEED_GRANT - expectedStake);
    },
  );

  test.each([
    ["Blue · 1 BB", 100, "Blue Team"],
    ["Red · 1 BB", 200, "Red Team"],
  ])(
    "%s persists the selected team through a Red-side anchor",
    async (label, expectedTeamId, expectedTeamName) => {
      const redAnchorRoster = bucksTestRoster().map((participant, index) => ({
        ...participant,
        trackedAlias: index === 5 ? "bryan" : undefined,
      }));
      const customId = buttonIdForLabel(redAnchorRoster, label);

      const { interaction, replies } = fakeInteraction(customId);
      await handleBetButton(interaction, db);

      expect(replies[0]).toContain(expectedTeamName);
      const bet = await db.bucksBet.findFirstOrThrow();
      expect(bet.predictedTeamId).toBe(expectedTeamId);
    },
  );

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
    const refreshes: { matchId: string; serverId: string }[] = [];
    await handleBetButton(interaction, db, recordingRefreshes(refreshes));

    expect(replies[0]).toContain("Bet cancelled");
    expect(replies[0]).toContain(
      "stake **5 BB** − **1 BB house cut** = **4 BB returned**",
    );
    expect(await db.bucksBet.count()).toBe(0);

    const account = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
      },
    });
    expect(account.balance).toBe(SEED_GRANT - 1);

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL - SEED_GRANT + 1);
    expect(refreshes).toEqual([{ matchId: MATCH_ID, serverId: SERVER_ID }]);
  });

  test("refreshes the shared prematch summary after a placement", async () => {
    const refreshes: { matchId: string; serverId: string }[] = [];

    await handleBetButton(
      fakeInteraction(betId(0, "W", 5)).interaction,
      db,
      recordingRefreshes(refreshes),
    );

    expect(refreshes).toEqual([{ matchId: MATCH_ID, serverId: SERVER_ID }]);
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
    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
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
    const refreshes: { matchId: string; serverId: string }[] = [];
    await handleBetButton(interaction, db, recordingRefreshes(refreshes));

    expect(replies[0]).toContain("Betting has closed");
    expect(await db.bucksBet.count()).toBe(0);
    expect(refreshes).toEqual([]);
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
  test("builds one row of five components for both team outcomes", () => {
    const rows = buildBettingRows({
      matchId: MATCH_ID,
      roster: bucksTestRoster(),
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("expected a betting row");
    }
    expect(row.components).toHaveLength(5);
    expect(
      row.components.map((button) => {
        const json = button.toJSON();
        return "label" in json ? json.label : undefined;
      }),
    ).toEqual([
      "Blue · 1 BB",
      "Blue · 5 BB",
      "Red · 1 BB",
      "Red · 5 BB",
      "Cancel",
    ]);
    expect(row.components.map((button) => button.toJSON().style)).toEqual([
      ButtonStyle.Primary,
      ButtonStyle.Primary,
      ButtonStyle.Danger,
      ButtonStyle.Danger,
      ButtonStyle.Secondary,
    ]);
  });

  test("uses one tracked player as the anchor even when several share a team", () => {
    const roster = bucksTestRoster().map((participant, index) => ({
      ...participant,
      trackedAlias: index === 0 ? "jerred" : index === 1 ? "aaron" : undefined,
    }));

    const rows = buildBettingRows({ matchId: MATCH_ID, roster });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.components).toHaveLength(5);
  });

  test("maps direct team choices through a Red-side anchor", () => {
    const roster = bucksTestRoster().map((participant, index) => ({
      ...participant,
      trackedAlias: index === 5 ? "bryan" : undefined,
    }));
    const rows = buildBettingRows({ matchId: MATCH_ID, roster });
    const row = rows[0];
    if (row === undefined) {
      throw new Error("expected a betting row");
    }

    const sides = row.components.slice(0, 4).map((button) => {
      const json = button.toJSON();
      if (!("custom_id" in json)) {
        throw new Error("team betting buttons must carry a custom id");
      }
      return parseBucksCustomId(json.custom_id)?.side;
    });
    expect(sides).toEqual(["L", "L", "W", "W"]);
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

  test("renders the whole team row disabled after the window closes", () => {
    const rows = buildBettingRows({
      matchId: MATCH_ID,
      roster: bucksTestRoster(),
      disabled: true,
    });
    expect(
      rows[0]?.components.every((button) => button.toJSON().disabled),
    ).toBe(true);
  });
});
