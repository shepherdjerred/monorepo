import { describe, expect, test } from "vitest";
import {
  BucksDareHorizonKindSchema,
  BucksDareStateSchema,
  BucksLedgerContextSchema,
  BucksLedgerKindSchema,
  BucksMatchingSummarySchema,
  StoredBucksLedgerContextSchema,
  type BucksLedgerContext,
} from "./bryan-bucks.ts";
import {
  BucksAmountSchema,
  BucksPoolTotalSchema,
  BucksStakeSchema,
  type BucksPoolTotal,
} from "./bryan-bucks-money.ts";

const stake = (value: number) => BucksStakeSchema.parse(value);
const amount = (value: number) => BucksAmountSchema.parse(value);
const pool = (value: number) => BucksPoolTotalSchema.parse(value);

describe("BucksLedgerKindSchema dare kinds", () => {
  test.each(["dare_stake", "dare_payout", "dare_refund", "dare_fee"] as const)(
    "accepts %s",
    (kind) => {
      expect(BucksLedgerKindSchema.parse(kind)).toBe(kind);
    },
  );

  test("rejects an unknown dare kind", () => {
    expect(BucksLedgerKindSchema.safeParse("dare_bonus").success).toBe(false);
  });
});

describe("BucksDareStateSchema", () => {
  test.each([
    "proposed",
    "pending_accept",
    "active",
    "achieved",
    "unachieved",
    "declined",
    "expired",
    "voided",
    "abandoned",
  ] as const)("accepts %s", (state) => {
    expect(BucksDareStateSchema.parse(state)).toBe(state);
  });

  test("rejects an unknown state", () => {
    expect(BucksDareStateSchema.safeParse("settled").success).toBe(false);
  });
});

describe("BucksDareHorizonKindSchema", () => {
  test.each(["next_game", "window"] as const)("accepts %s", (kind) => {
    expect(BucksDareHorizonKindSchema.parse(kind)).toBe(kind);
  });

  test("rejects an unknown horizon", () => {
    expect(BucksDareHorizonKindSchema.safeParse("season").success).toBe(false);
  });
});

describe("BucksMatchingSummarySchema pool aggregates", () => {
  const summary = {
    version: 1,
    humanMatchedPerSide: 120,
    houseFill: 0,
    houseTeamId: null,
    houseBetId: null,
    totalMatchedPerSide: 120,
    allocations: [],
  };

  test("round-trips a stored summary through JSON", () => {
    const stored = JSON.stringify(summary);
    expect(BucksMatchingSummarySchema.parse(JSON.parse(stored))).toEqual(
      summary,
    );
  });

  test("the side totals carry the pool-total brand", () => {
    // They are sums across every position on a side — the shape
    // `BucksPoolTotal` exists to name — and were bare nonnegative ints: the
    // same domain spelled out by hand, which no call site could be held to.
    const parsed = BucksMatchingSummarySchema.parse(summary);
    const asPoolTotals: BucksPoolTotal[] = [
      parsed.humanMatchedPerSide,
      parsed.houseFill,
      parsed.totalMatchedPerSide,
    ];
    expect(asPoolTotals).toEqual([120, 0, 120]);
  });

  test("the validated domain did not move, so stored blobs still parse", () => {
    // Unlike the settlement context below, branding these was safe on the read
    // side too: the brand IS `.int().nonnegative()`, so nothing that parsed
    // before can fail now, and a negative was never representable anyway.
    expect(
      BucksMatchingSummarySchema.safeParse({
        ...summary,
        humanMatchedPerSide: -1,
      }).success,
    ).toBe(false);
    expect(
      BucksMatchingSummarySchema.safeParse({ ...summary, houseFill: 0 })
        .success,
    ).toBe(true);
  });
});

describe("the settlement variant, written and stored", () => {
  const paidWinner: BucksLedgerContext = {
    type: "settlement",
    subjectAlias: "virmel",
    backedAliases: ["virmel"],
    opposingAliases: ["bryan"],
    winnersPool: pool(120),
    losersPool: pool(80),
    stakeReturned: amount(40),
    winnings: amount(36),
    grossPayout: amount(80),
    houseCut: amount(4),
    netPayout: amount(76),
    submittedStake: amount(40),
    matchedStake: amount(40),
    unmatchedStake: amount(0),
    payoutComponent: "gross",
  };

  const voidedRefund: BucksLedgerContext = {
    type: "settlement",
    subjectAlias: "virmel",
    backedAliases: ["virmel"],
    opposingAliases: ["bryan"],
    winnersPool: pool(0),
    losersPool: pool(0),
    stakeReturned: amount(40),
    winnings: amount(0),
    payoutComponent: "refund",
    voidReason: "no_counterparty",
  };

  test.each([
    ["a paid winner", paidWinner],
    ["a voided refund", voidedRefund],
  ])("round-trips %s row through JSON", (_label, context) => {
    const stored = JSON.stringify(context);
    expect(BucksLedgerContextSchema.parse(JSON.parse(stored))).toEqual(context);
    expect(StoredBucksLedgerContextSchema.parse(JSON.parse(stored))).toEqual(
      context,
    );
  });

  /**
   * Rows written before the money brands landed.
   *
   * `winnersPool`, `losersPool`, `stakeReturned` and `winnings` were persisted
   * as plain signed integers for the whole life of the feature until the
   * brands narrowed all four at once. Reading history back through the
   * narrowed schema would retroactively declare those rows invalid — the
   * ledger page loses the row's explanation and the dare repair script aborts
   * mid-scan — so the stored schema keeps the domain they were written in.
   */
  const historicalNegativeWinnings = {
    type: "settlement",
    subjectAlias: "virmel",
    backedAliases: ["virmel"],
    opposingAliases: ["bryan"],
    winnersPool: 120,
    losersPool: 80,
    stakeReturned: 40,
    winnings: -40,
  };

  test("a historical row with negative winnings still reads back", () => {
    const stored = JSON.stringify(historicalNegativeWinnings);
    expect(StoredBucksLedgerContextSchema.parse(JSON.parse(stored))).toEqual(
      historicalNegativeWinnings,
    );
  });

  test.each([
    ["winnings", { ...historicalNegativeWinnings, winnings: -40 }],
    [
      "stakeReturned",
      { ...historicalNegativeWinnings, winnings: 0, stakeReturned: -1 },
    ],
    [
      "winnersPool",
      { ...historicalNegativeWinnings, winnings: 0, winnersPool: -1 },
    ],
    [
      "losersPool",
      { ...historicalNegativeWinnings, winnings: 0, losersPool: -1 },
    ],
  ])("a negative %s is readable but no longer writable", (_field, row) => {
    expect(StoredBucksLedgerContextSchema.safeParse(row).success).toBe(true);
    // The tightening still holds going forward: nothing may WRITE one.
    expect(BucksLedgerContextSchema.safeParse(row).success).toBe(false);
  });

  test("the two unions differ in the settlement variant and nowhere else", () => {
    // A dare row is the same shape either way, so widening the read side did
    // not quietly relax every other variant with it.
    const dareRow = {
      type: "dare",
      dareId: 7,
      role: "contributor",
      targetAliases: ["virmel"],
      conditionSummary: "win 7 games on Warwick",
      potTotal: 12,
      amount: -5,
    };
    expect(StoredBucksLedgerContextSchema.safeParse(dareRow).success).toBe(
      false,
    );
    expect(BucksLedgerContextSchema.safeParse(dareRow).success).toBe(false);
  });

  test("neither union accepts a fractional settlement amount", () => {
    const fractional = { ...historicalNegativeWinnings, winnings: -0.5 };
    expect(StoredBucksLedgerContextSchema.safeParse(fractional).success).toBe(
      false,
    );
  });
});

describe("BucksLedgerContextSchema dare variant", () => {
  const contributorStake: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "contributor",
    targetAliases: ["virmel"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: stake(12),
    amount: stake(5),
    payoutComponent: "contribution",
  };

  const targetPayout: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "target",
    targetAliases: ["virmel", "bryan"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: stake(12),
    amount: stake(5),
    payoutComponent: "share",
    grossShare: 6,
    resolution: "achieved",
  };

  const houseRefundFee: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "house",
    targetAliases: ["virmel"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: stake(12),
    amount: stake(2),
    payoutComponent: "refund_fee",
    resolution: "unachieved",
  };

  const voidedRefund: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "contributor",
    targetAliases: ["virmel"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: stake(12),
    amount: stake(12),
    payoutComponent: "refund",
    resolution: "voided",
    voidReason: "evaluator version mismatch",
  };

  const cancelledV2Refund: BucksLedgerContext = {
    type: "dare",
    dareId: 8,
    contractVersion: 2,
    role: "contributor",
    targetAliases: ["virmel"],
    conditionSummary: "win one ranked game",
    potTotal: stake(20),
    amount: stake(20),
    payoutComponent: "refund",
    resolution: "cancelled",
  };

  const achievedV3Payout: BucksLedgerContext = {
    type: "dare",
    dareId: 9,
    contractVersion: 3,
    role: "target",
    targetAliases: ["virmel"],
    conditionSummary: `${"a".repeat(64)}: SELECT TRUE AS achieved`,
    potTotal: stake(20),
    amount: stake(20),
    payoutComponent: "share",
    resolution: "achieved",
  };

  test.each([
    ["contributor stake", contributorStake],
    ["target payout", targetPayout],
    ["house refund fee", houseRefundFee],
    ["voided refund", voidedRefund],
    ["cancelled v2 refund", cancelledV2Refund],
    ["achieved v3 payout", achievedV3Payout],
  ])("round-trips a %s row through JSON", (_label, context) => {
    const stored = JSON.stringify(context);
    expect(BucksLedgerContextSchema.parse(JSON.parse(stored))).toEqual(context);
  });

  test.each([
    ["an unknown role", { ...contributorStake, role: "spectator" }],
    [
      "a missing conditionSummary",
      (() => {
        const { conditionSummary: _dropped, ...rest } = contributorStake;
        return rest;
      })(),
    ],
    [
      "an empty conditionSummary",
      { ...contributorStake, conditionSummary: "" },
    ],
    ["no frozen target aliases", { ...contributorStake, targetAliases: [] }],
    ["an empty alias", { ...contributorStake, targetAliases: ["virmel", ""] }],
    ["a non-positive dareId", { ...contributorStake, dareId: 0 }],
    ["a zero amount", { ...contributorStake, amount: 0 }],
    [
      "an unknown payout component",
      { ...contributorStake, payoutComponent: "bonus" },
    ],
    ["an unknown resolution", { ...targetPayout, resolution: "forfeited" }],
    [
      "an unrecognized extra key",
      { ...contributorStake, extra: "strictObject rejects this" },
    ],
  ])("rejects %s", (_label, malformed) => {
    expect(BucksLedgerContextSchema.safeParse(malformed).success).toBe(false);
  });
});
