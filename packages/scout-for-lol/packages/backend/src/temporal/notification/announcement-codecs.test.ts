import {
  DiscordGuildIdSchema,
  DiscordChannelIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  RiotMatchIdSchema,
  DiscordMessageIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  BucksAmountSchema,
  BucksPoolTotalSchema,
  BucksStakeSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import type { SettlementAnnouncementInput } from "#src/betting/notify/announce-prepare.ts";
import {
  settlementAnnouncementCodec,
  settlementAnnouncementEnvelope,
  settlementAnnouncementInputOf,
  hallRecordBreakAnnouncementCodec,
  hallRecordBreakAnnouncementEnvelope,
} from "#src/temporal/notification/announcement-codecs.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import {
  hallBreakRecords,
  hallGuildId,
  hallRiotMatchId,
} from "#src/temporal/notification/hall-record-break.test-fixtures.ts";

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
      matchId: RiotMatchIdSchema.parse("NA1_9301"),
      serverId: DiscordGuildIdSchema.parse("100000000000000001"),
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
      matchId: RiotMatchIdSchema.parse("NA1_9301"),
      serverId: DiscordGuildIdSchema.parse("100000000000000001"),
      yesResult: false,
      voidReason: undefined,
      legs: [],
      messageRefs: [
        {
          channelId: DiscordChannelIdSchema.parse("300000000000000001"),
          messageId: DiscordMessageIdSchema.parse("400000000000000001"),
        },
      ],
      bets: [
        {
          discordId: DiscordAccountIdSchema.parse("200000000000000002"),
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
        serverId: DiscordGuildIdSchema.parse("100000000000000001"),
        discordId: DiscordAccountIdSchema.parse("200000000000000002"),
        alias: "Alice",
        reasons: ["played", "win"],
        total: 2,
      },
    ],
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

function hallEnvelope(count?: number) {
  return hallRecordBreakAnnouncementEnvelope({
    guildId: hallGuildId,
    riotMatchId: hallRiotMatchId,
    records: hallBreakRecords(count),
  });
}

describe("the hall record-break announcement codec", () => {
  test("round-trips v1's outbox records through the intent envelope", () => {
    const input = {
      guildId: hallGuildId,
      riotMatchId: hallRiotMatchId,
      records: hallBreakRecords(),
    };
    const parsed = hallRecordBreakAnnouncementCodec.parse(
      structuredClone(hallRecordBreakAnnouncementEnvelope(input)),
    );
    expect(parsed).toEqual(input);
  });

  test("carries the records exactly as v1's outbox stores them", () => {
    const envelope = structuredClone(hallEnvelope());
    expect(JSON.stringify(envelope.data.records)).toBe(
      JSON.stringify(hallBreakRecords()),
    );
  });

  test("drops a record id retired by a catalog rename, as v1's reader does", () => {
    const envelope = hallEnvelope(1);
    const parsed = hallRecordBreakAnnouncementCodec.parse({
      ...envelope,
      data: {
        ...envelope.data,
        records: [
          { ...envelope.data.records[0], recordId: "largest_multikill" },
        ],
      },
    });
    expect(parsed.records).toEqual([]);
  });

  test("still refuses a record id nobody retired", () => {
    const envelope = hallEnvelope(1);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: {
          ...envelope.data,
          records: [{ ...envelope.data.records[0], recordId: "made_up" }],
        },
      }),
    ).toThrow();
  });

  test("refuses a record from another match in the same announcement", () => {
    const envelope = hallEnvelope(2);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: {
          ...envelope.data,
          records: [
            envelope.data.records[0],
            { ...envelope.data.records[1], matchId: "NA1_9302" },
          ],
        },
      }),
    ).toThrow("Hall records must belong to the announced match");
  });

  test("refuses a channel in the payload: the intent's target owns it", () => {
    const envelope = hallEnvelope(1);
    expect(() =>
      hallRecordBreakAnnouncementCodec.parse({
        ...envelope,
        data: { ...envelope.data, channelId: "300000000000000001" },
      }),
    ).toThrow();
  });
});

describe("the hall record-break intent key", () => {
  test("names the match and the guild, never the channel", () => {
    expect(hallRecordBreakIntentKey(hallRiotMatchId, hallGuildId)).toBe(
      "hall-record-break:NA1_9301:100000000000000001",
    );
  });
});
