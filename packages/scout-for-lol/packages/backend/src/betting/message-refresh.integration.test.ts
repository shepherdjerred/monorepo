import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { MessageCreateOptions } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import {
  refreshBucksMessages,
  type BucksMessageEdit,
} from "#src/betting/message-refresh.ts";
import {
  announceSettlements,
  sendSettlementMessage,
  type SettlementDeliveryDependencies,
} from "#src/betting/announce.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import { recordPoolMessageRefs } from "#src/betting/pool-open.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { registry } from "#src/metrics/registry.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-message-refresh");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const MATCH_ID = "NA1_5000000042";
const CHANNEL_ONE = DiscordChannelIdSchema.parse("1337623164146155594");
const CHANNEL_TWO = DiscordChannelIdSchema.parse("1337623164146155595");

type RecordedEdit = {
  channelId: DiscordChannelId;
  messageId: string;
  content: string;
  removedComponents: boolean;
  suppressedMentions: boolean;
};

function recordingEditor(edits: RecordedEdit[]): BucksMessageEdit {
  return (input) => {
    if (typeof input.options.content !== "string") {
      throw new TypeError("expected refreshed message content");
    }
    edits.push({
      channelId: input.channelId,
      messageId: input.messageId,
      content: input.options.content,
      removedComponents:
        Array.isArray(input.options.components) &&
        input.options.components.length === 0,
      suppressedMentions: input.options.allowedMentions?.parse?.length === 0,
    });
    return Promise.resolve();
  };
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

async function createPool(input?: {
  prematchContentBase?: string | null;
  refs?: readonly { channelId: string; messageId: string }[];
}) {
  return await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      messageRefs: JSON.stringify(
        input?.refs ?? [
          { channelId: CHANNEL_ONE, messageId: "prematch-one" },
          { channelId: CHANNEL_TWO, messageId: "prematch-two" },
        ],
      ),
      prematchContentBase:
        input?.prematchContentBase === undefined
          ? "Aaron started a game"
          : input.prematchContentBase,
    },
  });
}

async function addPosition(input: {
  poolId: number;
  accountIndex: number;
  teamId: 100 | 200;
  stake: number;
  isHouse?: boolean;
  matchedStake?: number;
  unmatchedStake?: number;
}): Promise<void> {
  const account = await db.bucksAccount.create({
    data: {
      serverId: SERVER_ID,
      discordId: bucksTestDiscordId(input.accountIndex),
      isHouse: input.isHouse ?? false,
      balance: 100,
    },
  });
  await db.bucksBet.create({
    data: {
      poolId: input.poolId,
      bucksAccountId: account.id,
      predictedTeamId: input.teamId,
      subjectPuuid: bucksTestPuuid(input.accountIndex),
      stake: input.stake,
      ...(input.matchedStake === undefined
        ? {}
        : { matchedStake: input.matchedStake }),
      ...(input.unmatchedStake === undefined
        ? {}
        : { unmatchedStake: input.unmatchedStake }),
    },
  });
}

function remakeSettlement(): SettlementSummary {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    winningTeamId: undefined,
    voidReason: "remake",
    winnersPool: 0,
    losersPool: 0,
    houseCut: 0,
    bets: [],
  };
}

/** A settlement one human actually won, so it has an outcome worth posting. */
function decidedSettlement(): SettlementSummary {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    winningTeamId: 100,
    voidReason: undefined,
    winnersPool: 5,
    losersPool: 5,
    houseCut: 1,
    bets: [
      {
        betId: 1,
        bucksAccountId: 1,
        discordId: bucksTestDiscordId(1),
        isHouse: false,
        predictedTeamId: 100,
        submittedStake: 5,
        matchedStake: 5,
        unmatchedStake: 0,
        grossPayout: 10,
        houseCut: 1,
        payout: 9,
        winnings: 4,
        subjectPuuid: bucksTestPuuid(1),
        won: true,
        refunded: false,
      },
    ],
  };
}

function parlaySettlement(): ParlaySettlementSummary {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    yesResult: true,
    voidReason: undefined,
    legs: [],
    messageRefs: [],
    bets: [
      {
        discordId: bucksTestDiscordId(1),
        side: "YES",
        stake: 5,
        grossPayout: 10,
        payout: 10,
        outcome: "won",
      },
    ],
  };
}

/** The nonce one settlement delivery of `kind` carries into this channel. */
async function capturedNonce(kind: "outcome" | "parlay"): Promise<unknown> {
  const attempts: MessageCreateOptions[] = [];
  await sendSettlementMessage(
    {
      message: { embeds: [{ title: "Bryan Bucks" }] },
      matchId: MATCH_ID,
      channelId: CHANNEL_ONE,
      guildId: SERVER_ID,
      kind,
    },
    {
      sendMessage: (options) => {
        attempts.push(options);
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
    },
  );
  return attempts[0]?.nonce;
}

type AnnouncePass = Parameters<typeof announceSettlements>[0];

/** Run one announcement pass for this match against a recording transport. */
async function announcePass(
  input: Partial<Omit<AnnouncePass, "matchId">>,
  sendMessage: SettlementDeliveryDependencies["sendMessage"],
): Promise<void> {
  await announceSettlements(
    {
      matchId: MATCH_ID,
      closures: input.closures ?? [],
      settlements: input.settlements ?? [],
      parlaySettlements: input.parlaySettlements ?? [],
      earnings: input.earnings ?? [],
      postmatchMessageIds: input.postmatchMessageIds ?? new Map(),
    },
    db,
    { sendMessage, sleep: () => Promise.resolve() },
  );
}

/** The messages one announcement pass delivers, in delivery order. */
async function announcedMessages(
  input: Partial<Omit<AnnouncePass, "matchId">>,
): Promise<MessageCreateOptions[]> {
  const sends: MessageCreateOptions[] = [];
  await announcePass(input, (options) => {
    sends.push(options);
    return Promise.resolve();
  });
  return sends;
}

beforeEach(async () => {
  await clearAll();
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("refreshBucksMessages", () => {
  test("edits every prematch message with named human positions", async () => {
    const pool = await createPool();
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 6,
    });
    await addPosition({
      poolId: pool.id,
      accountIndex: 2,
      teamId: 200,
      stake: 5,
    });
    const edits: RecordedEdit[] = [];

    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits).toHaveLength(2);
    expect(edits.map((edit) => edit.messageId)).toEqual([
      "prematch-one",
      "prematch-two",
    ]);
    expect(edits.every((edit) => edit.suppressedMentions)).toBe(true);
    expect(edits.every((edit) => !edit.removedComponents)).toBe(true);
    expect(edits[0]?.content).toContain("🎲 **Bets open**");
    // The refresh supplies the authoritative close time from the pool.
    expect(edits[0]?.content).toContain("closes <t:");
    expect(edits[0]?.content).toContain("Blue **6 BB** · Red **5 BB**");
    expect(edits[0]?.content).toContain(`<@${bucksTestDiscordId(1)}>`);
    expect(edits[0]?.content).toContain(`<@${bucksTestDiscordId(2)}>`);
    expect(edits[0]?.content).not.toContain(`<@${bucksTestDiscordId(99)}>`);

    await db.bucksBet.updateMany({
      where: { poolId: pool.id, predictedTeamId: 200 },
      data: { betOutcome: "cancelled" },
    });
    edits.length = 0;
    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );
    expect(edits[0]?.content).not.toContain(`<@${bucksTestDiscordId(2)}>`);
    expect(edits[0]?.content).toContain("Blue **6 BB** · Red **0 BB**");
    expect(await db.bucksBet.count({ where: { poolId: pool.id } })).toBe(2);
  });

  test("does not edit a pre-deployment pool with no stored content base", async () => {
    await createPool({ prematchContentBase: null });
    const edits: RecordedEdit[] = [];

    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits).toEqual([]);
  });

  test("recovers a bet placed while the initial message references are being recorded", async () => {
    const pool = await createPool({ prematchContentBase: null, refs: [] });
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 5,
    });
    const edits: RecordedEdit[] = [];

    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );
    expect(edits).toEqual([]);

    await recordPoolMessageRefs(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        refs: [{ channelId: CHANNEL_ONE, messageId: "prematch-one" }],
        prematchContentBase: "Aaron started a game",
      },
      db,
    );
    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits).toHaveLength(1);
    expect(edits[0]?.content).toContain(`<@${bucksTestDiscordId(1)}>`);
  });

  test("removes controls and shows exact final allocations after close", async () => {
    const pool = await createPool();
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 5,
      matchedStake: 5,
      unmatchedStake: 0,
    });
    await addPosition({
      poolId: pool.id,
      accountIndex: 2,
      teamId: 200,
      stake: 1,
      matchedStake: 1,
      unmatchedStake: 0,
    });
    await addPosition({
      poolId: pool.id,
      accountIndex: 99,
      teamId: 200,
      stake: 4,
      isHouse: true,
      matchedStake: 4,
      unmatchedStake: 0,
    });
    await db.bucksMatchPool.update({
      where: { id: pool.id },
      data: { poolState: "closed" },
    });
    const edits: RecordedEdit[] = [];

    await refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID, removeComponents: true },
      db,
      recordingEditor(edits),
    );

    expect(edits.every((edit) => edit.removedComponents)).toBe(true);
    expect(edits[0]?.content).toContain(
      "🎲 **Bets closed** — Blue **5 BB** · Red **5 BB**",
    );
    // The aggregate house fill, without exposing the synthetic account.
    expect(edits[0]?.content).toContain("(house **4** on Red)");
    expect(edits[0]?.content).toContain(
      `<@${bucksTestDiscordId(1)}> Blue 5 → matched **5**`,
    );
    // A fully matched offer says nothing about a zero refund.
    expect(edits[0]?.content).not.toContain("refunded **0**");
    // The market never restates the fee schedule.
    expect(edits[0]?.content).not.toContain("20%");
    expect(edits[0]?.content).not.toContain(`<@${bucksTestDiscordId(99)}>`);
  });

  test("serializes refreshes so the final edit reads the newest positions", async () => {
    const pool = await createPool({
      refs: [{ channelId: CHANNEL_ONE, messageId: "prematch-one" }],
    });
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 5,
    });
    const firstEditStarted = Promise.withResolvers<undefined>();
    const releaseFirstEdit = Promise.withResolvers<undefined>();
    const contents: string[] = [];
    let editCount = 0;
    const editor: BucksMessageEdit = async (input) => {
      editCount += 1;
      if (editCount === 1) {
        firstEditStarted.resolve(undefined);
        await releaseFirstEdit.promise;
      }
      if (typeof input.options.content !== "string") {
        throw new TypeError("expected refreshed message content");
      }
      contents.push(input.options.content);
    };

    const first = refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      editor,
    );
    await firstEditStarted.promise;
    await addPosition({
      poolId: pool.id,
      accountIndex: 2,
      teamId: 200,
      stake: 5,
    });
    const second = refreshBucksMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      editor,
    );
    releaseFirstEdit.resolve(undefined);
    await Promise.all([first, second]);

    expect(contents).toHaveLength(2);
    expect(contents[0]).not.toContain(`<@${bucksTestDiscordId(2)}>`);
    expect(contents[1]).toContain(`<@${bucksTestDiscordId(2)}>`);
  });
});

describe("announceSettlements", () => {
  test("uses the exact postmatch message ID for each channel", async () => {
    await createPool({ prematchContentBase: null });
    const sends: {
      channelId: DiscordChannelId;
      options: MessageCreateOptions;
    }[] = [];

    await announcePass(
      {
        settlements: [decidedSettlement()],
        postmatchMessageIds: new Map([[CHANNEL_ONE, "postmatch-one"]]),
      },
      (options, channelId) => {
        sends.push({ channelId, options });
        return Promise.resolve();
      },
    );

    expect(sends).toHaveLength(2);
    expect(sends[0]?.channelId).toBe(CHANNEL_ONE);
    expect(sends[0]?.options.reply).toEqual({
      messageReference: "postmatch-one",
      failIfNotExists: false,
    });
    expect(sends[1]?.channelId).toBe(CHANNEL_TWO);
    expect(sends[1]?.options.reply).toBeUndefined();
  });

  test("isolates a failed outcome channel from later channels", async () => {
    await createPool({ prematchContentBase: null });
    const attempts: DiscordChannelId[] = [];

    await announcePass(
      { settlements: [decidedSettlement()] },
      (_options, channelId) => {
        attempts.push(channelId);
        return channelId === CHANNEL_ONE
          ? Promise.reject(new Error("channel delivery failed"))
          : Promise.resolve();
      },
    );

    expect(
      attempts.filter((channelId) => channelId === CHANNEL_ONE),
    ).toHaveLength(3);
    expect(
      attempts.filter((channelId) => channelId === CHANNEL_TWO),
    ).toHaveLength(1);
  });
});

describe("announceSettlements visibility", () => {
  // A settled pool whose only bets were house fills has a title and nothing
  // else to say. Whether it has anything is only knowable after reading the
  // pool's stored refunds, which is why this is asserted end to end.
  test("withholds a settlement with nothing player-visible", async () => {
    await createPool({ prematchContentBase: null });
    const sends = await announcedMessages({
      settlements: [remakeSettlement()],
    });

    expect(sends).toEqual([]);
  });

  test("announces a settlement that only earned Bucks", async () => {
    await createPool({ prematchContentBase: null });
    const sends = await announcedMessages({
      settlements: [remakeSettlement()],
      earnings: [
        {
          serverId: SERVER_ID,
          discordId: bucksTestDiscordId(1),
          alias: "Sean",
          reasons: ["played"],
          total: 1,
        },
      ],
    });

    expect(sends).toHaveLength(2);
    expect(JSON.stringify(sends[0])).toContain("Sean");
  });

  // An empty outcome paired with a parlay is delivered as the parlay carrier,
  // not as an outcome that happens to be blank. The nonce is where that
  // matters: an outcome nonce here would collide with the outcome embed an
  // earlier tick already delivered to this channel, and Discord would drop the
  // parlay result that can never be re-derived.
  test("carries a parlay without an empty outcome section", async () => {
    await createPool({ prematchContentBase: null });
    const sends = await announcedMessages({
      parlaySettlements: [parlaySettlement()],
      settlements: [remakeSettlement()],
    });

    expect(sends).toHaveLength(2);
    expect(JSON.stringify(sends[0])).toContain("PARLAY WINNERS");
    expect(sends[0]?.nonce).toBe(await capturedNonce("parlay"));
    expect(sends[0]?.nonce).not.toBe(await capturedNonce("outcome"));
  });
});

describe("announceSettlements unmatched receipts", () => {
  test("announces a fully unmatched offer without a settlement", async () => {
    const pool = await createPool({ prematchContentBase: null });
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 9,
      matchedStake: 0,
      unmatchedStake: 9,
    });
    await db.bucksBet.updateMany({
      where: { poolId: pool.id },
      data: {
        betOutcome: "refunded",
        humanMatchedStake: 0,
        houseMatchedStake: 0,
        grossPayout: 0,
        fee: 0,
        payout: 0,
      },
    });
    const sends = await announcedMessages({
      closures: [
        {
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          messageRefs: [],
          humanMatchedPerSide: 0,
          houseFill: 0,
          totalMatchedPerSide: 0,
          positions: [
            {
              betId: 1,
              discordId: bucksTestDiscordId(1),
              teamId: 100,
              submittedStake: 9,
              matchedStake: 0,
              unmatchedStake: 9,
            },
          ],
        },
      ],
    });

    expect(sends).toHaveLength(2);
    const outcome = JSON.stringify(sends[0]);
    expect(outcome).toContain(`BET REFUNDS: **9BB** across 1 bet.`);
    expect(outcome).not.toContain(`<@${bucksTestDiscordId(1)}>`);
  });

  test("does not announce a partial close before matched refunds commit", async () => {
    await createPool({ prematchContentBase: null });
    const sends = await announcedMessages({
      closures: [
        {
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          messageRefs: [],
          humanMatchedPerSide: 1,
          houseFill: 0,
          totalMatchedPerSide: 1,
          positions: [
            {
              betId: 1,
              discordId: bucksTestDiscordId(1),
              teamId: 100,
              submittedStake: 9,
              matchedStake: 1,
              unmatchedStake: 8,
            },
            {
              betId: 2,
              discordId: bucksTestDiscordId(2),
              teamId: 100,
              submittedStake: 1,
              matchedStake: 0,
              unmatchedStake: 1,
            },
          ],
        },
      ],
    });

    expect(sends).toEqual([]);
  });

  test("recovers unmatched rows when a settlement retry has no closure", async () => {
    const pool = await createPool({ prematchContentBase: null });
    await addPosition({
      poolId: pool.id,
      accountIndex: 1,
      teamId: 100,
      stake: 9,
      matchedStake: 0,
      unmatchedStake: 9,
    });
    await db.bucksBet.updateMany({
      where: { poolId: pool.id },
      data: {
        betOutcome: "refunded",
        humanMatchedStake: 0,
        houseMatchedStake: 0,
        grossPayout: 0,
        fee: 0,
        payout: 0,
      },
    });
    const sends = await announcedMessages({
      settlements: [remakeSettlement()],
    });

    const outcome = JSON.stringify(sends[0]);
    expect(outcome).toContain(`BET REFUNDS: **9BB** across 1 bet (remake).`);
    expect(outcome).not.toContain(`<@${bucksTestDiscordId(1)}>`);
  });
});

describe("refreshBucksMessages observability", () => {
  // These three paths returned silently before, which is exactly what made
  // "why didn't the message update?" unanswerable.
  test("counts each silent refresh skip instead of returning quietly", async () => {
    const found = registry.getSingleMetric("betting_message_operations_total");
    if (found === undefined) {
      throw new Error("betting_message_operations_total is not registered");
    }
    const metric = found;
    async function skipCount(reason: string): Promise<number> {
      const collected = await metric.get();
      return (
        collected.values.find(
          (value) =>
            value.labels["surface"] === "prematch" &&
            value.labels["result"] === reason,
        )?.value ?? 0
      );
    }

    const before = await skipCount("skipped_no_pool");
    await refreshBucksMessages(
      { matchId: "NA1_does-not-exist", serverId: SERVER_ID },
      db,
      recordingEditor([]),
    );
    expect(await skipCount("skipped_no_pool")).toBe(before + 1);
  });
});
