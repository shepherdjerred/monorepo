import { describe, expect, test } from "vitest";
import {
  BucksAmountSchema,
  BucksPoolTotalSchema,
  BucksStakeSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import type { SettlementAnnouncementInput } from "#src/betting/notify/announce-prepare.ts";
import {
  dareSettlementSummaryOf,
  dareSummaryAnnouncementCodec,
  dareSummaryAnnouncementEnvelope,
  settlementAnnouncementCodec,
  settlementAnnouncementEnvelope,
  settlementAnnouncementInputOf,
} from "#src/temporal/v2/notification/announcement-codecs.ts";

/**
 * The envelope a minter writes is the announcement the arm reads: v1's own
 * types in, the same values out, through a structural clone like the intent
 * row's JSON column (the envelopes omit undefined members, so the two agree). The typed fixtures are what pins the mirror — a field v1 adds fails
 * to compile here, a field the schema invents fails the strict parse.
 */

const amount = (value: number) => BucksAmountSchema.parse(value);

function settlementInput(): SettlementAnnouncementInput {
  return {
    summary: {
      matchId: "NA1_9301",
      serverId: "100000000000000001",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: BucksPoolTotalSchema.parse(30),
      losersPool: BucksPoolTotalSchema.parse(20),
      houseCut: BucksPoolTotalSchema.parse(2),
      bets: [
        {
          betId: 7,
          bucksAccountId: 3,
          discordId: DiscordAccountIdSchema.parse("200000000000000002"),
          isHouse: false,
          predictedTeamId: 100,
          submittedStake: BucksStakeSchema.parse(10),
          matchedStake: amount(10),
          unmatchedStake: amount(0),
          grossPayout: amount(20),
          houseCut: amount(1),
          payout: amount(19),
          winnings: amount(9),
          won: true,
          refunded: false,
          subjectPuuid: LeaguePuuidSchema.parse("p".repeat(78)),
        },
      ],
    },
    includeOutcome: true,
    parlay: {
      matchId: "NA1_9301",
      serverId: "100000000000000001",
      yesResult: false,
      voidReason: undefined,
      legs: [],
      messageRefs: [
        { channelId: "300000000000000001", messageId: "400000000000000001" },
      ],
      bets: [
        {
          discordId: "200000000000000002",
          side: "YES",
          stake: 5,
          grossPayout: 0,
          payout: 0,
          outcome: "lost",
        },
      ],
    },
    earnings: [
      {
        serverId: "100000000000000001",
        discordId: "200000000000000002",
        alias: "Alice",
        reasons: ["played", "win"],
        total: 2,
      },
    ],
  };
}

function dareSummary(): DareSettlementSummary {
  return {
    dareId: 42,
    serverId: "100000000000000001",
    channelId: "300000000000000001",
    messageRef: null,
    matchId: "NA1_9301",
    resolution: "achieved",
    horizonKind: "next_game",
    challengerDiscordId: "200000000000000002",
    targetAliases: ["Bob"],
    conditionSummary: "get a pentakill",
    potTotal: 50,
    payouts: [
      {
        bucksAccountId: 4,
        discordId: "200000000000000003",
        alias: "Bob",
        grossShare: amount(50),
        fee: amount(2),
        net: amount(48),
      },
    ],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
  };
}

describe("the settlement announcement codec", () => {
  test("round-trips v1's announcement input through the intent envelope", () => {
    const input = settlementInput();
    const wire = structuredClone(settlementAnnouncementEnvelope(input));
    const parsed = settlementAnnouncementInputOf(
      settlementAnnouncementCodec.parse(wire),
    );
    expect(parsed).toEqual(input);
  });

  test("keeps an absent parlay and a void reason apart from their presence", () => {
    const input = settlementInput();
    const voided: SettlementAnnouncementInput = {
      ...input,
      parlay: undefined,
      summary: {
        ...input.summary,
        winningTeamId: undefined,
        voidReason: "remake",
      },
    };
    const parsed = settlementAnnouncementInputOf(
      settlementAnnouncementCodec.parse(
        structuredClone(settlementAnnouncementEnvelope(voided)),
      ),
    );
    expect(parsed).toEqual(voided);
  });

  test("refuses a payload the announcement does not need", () => {
    const envelope = settlementAnnouncementEnvelope(settlementInput());
    expect(() =>
      settlementAnnouncementCodec.parse({
        ...envelope,
        data: { ...envelope.data, postmatchMessageIds: {} },
      }),
    ).toThrow();
  });
});

describe("the dare summary announcement codec", () => {
  test("round-trips v1's settlement summary through the intent envelope", () => {
    const summary = dareSummary();
    const parsed = dareSettlementSummaryOf(
      dareSummaryAnnouncementCodec.parse(
        structuredClone(dareSummaryAnnouncementEnvelope(summary)),
      ),
    );
    expect(parsed).toEqual(summary);
  });

  test("carries refunds and a void reason for a voided dare", () => {
    const summary: DareSettlementSummary = {
      ...dareSummary(),
      resolution: "voided",
      payouts: [],
      refunds: [
        {
          bucksAccountId: 3,
          discordId: "200000000000000002",
          contributed: amount(50),
          fee: amount(0),
          refunded: amount(50),
        },
      ],
      voidReason: "remake",
      leafCounts: [1, 0],
    };
    const parsed = dareSettlementSummaryOf(
      dareSummaryAnnouncementCodec.parse(
        structuredClone(dareSummaryAnnouncementEnvelope(summary)),
      ),
    );
    expect(parsed).toEqual(summary);
  });
});
