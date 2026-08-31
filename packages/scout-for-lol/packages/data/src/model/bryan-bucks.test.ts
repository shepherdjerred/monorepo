import { describe, expect, test } from "vitest";
import {
  BucksDareHorizonKindSchema,
  BucksDareStateSchema,
  BucksLedgerContextSchema,
  BucksLedgerKindSchema,
  type BucksLedgerContext,
} from "./bryan-bucks.ts";

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

describe("BucksLedgerContextSchema dare variant", () => {
  const contributorStake: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "contributor",
    targetAliases: ["virmel"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: 12,
    amount: 5,
    payoutComponent: "contribution",
  };

  const targetPayout: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "target",
    targetAliases: ["virmel", "bryan"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: 12,
    amount: 5,
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
    potTotal: 12,
    amount: 2,
    payoutComponent: "refund_fee",
    resolution: "unachieved",
  };

  const voidedRefund: BucksLedgerContext = {
    type: "dare",
    dareId: 7,
    role: "contributor",
    targetAliases: ["virmel"],
    conditionSummary: "win 7 games on Warwick",
    potTotal: 12,
    amount: 12,
    payoutComponent: "refund",
    resolution: "voided",
    voidReason: "evaluator version mismatch",
  };

  test.each([
    ["contributor stake", contributorStake],
    ["target payout", targetPayout],
    ["house refund fee", houseRefundFee],
    ["voided refund", voidedRefund],
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
    ["an unknown resolution", { ...targetPayout, resolution: "cancelled" }],
    [
      "an unrecognized extra key",
      { ...contributorStake, extra: "strictObject rejects this" },
    ],
  ])("rejects %s", (_label, malformed) => {
    expect(BucksLedgerContextSchema.safeParse(malformed).success).toBe(false);
  });
});
