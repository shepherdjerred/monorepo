import { describe, expect, expectTypeOf, test } from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksAmountSchema,
  BucksDeltaSchema,
  BucksStakeSchema,
  ZERO_BUCKS,
  addAmounts,
  amountToStake,
  applyDelta,
  creditOf,
  debitOf,
  stakeToAmount,
  subtractAmounts,
  type BucksAmount,
  type BucksDelta,
  type BucksStake,
} from "./bryan-bucks-money.ts";

const stake = (value: number) => BucksStakeSchema.parse(value);
const amount = (value: number) => BucksAmountSchema.parse(value);
const delta = (value: number) => BucksDeltaSchema.parse(value);

describe("BucksStakeSchema", () => {
  test.each([1, 25, BUCKS_INT32_MAX])("accepts %d", (value) => {
    expect(BucksStakeSchema.parse(value)).toBe(value);
  });

  test.each([0, -1, 1.5, BUCKS_INT32_MAX + 1, Number.NaN])(
    "rejects %d",
    (value) => {
      expect(BucksStakeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("BucksAmountSchema", () => {
  test.each([0, 1, BUCKS_INT32_MAX])("accepts %d", (value) => {
    expect(BucksAmountSchema.parse(value)).toBe(value);
  });

  test.each([-1, 0.5, BUCKS_INT32_MAX + 1, Number.NaN])(
    "rejects %d",
    (value) => {
      expect(BucksAmountSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("BucksDeltaSchema", () => {
  test.each([1, -1, BUCKS_INT32_MAX, -BUCKS_INT32_MAX])(
    "accepts %d",
    (value) => {
      expect(BucksDeltaSchema.parse(value)).toBe(value);
    },
  );

  test.each([0, 2.5, BUCKS_INT32_MAX + 1, -(BUCKS_INT32_MAX + 1), Number.NaN])(
    "rejects %d",
    (value) => {
      expect(BucksDeltaSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("checked arithmetic", () => {
  test("addAmounts sums and stays branded", () => {
    expect(addAmounts(amount(3), amount(4), amount(0))).toBe(7);
  });

  test("addAmounts throws when the sum leaves Int32", () => {
    expect(() => addAmounts(amount(BUCKS_INT32_MAX), amount(1))).toThrow();
  });

  test("subtractAmounts subtracts", () => {
    expect(subtractAmounts(amount(10), amount(4))).toBe(6);
  });

  test("subtractAmounts throws when the result would be negative", () => {
    expect(() => subtractAmounts(amount(4), amount(10))).toThrow();
  });

  test("applyDelta credits and debits", () => {
    expect(applyDelta(amount(10), delta(5))).toBe(15);
    expect(applyDelta(amount(10), delta(-10))).toBe(0);
  });

  test("applyDelta throws when the result would be negative", () => {
    expect(() => applyDelta(amount(3), delta(-4))).toThrow();
  });

  test("applyDelta throws when the result overflows Int32", () => {
    expect(() => applyDelta(amount(BUCKS_INT32_MAX), delta(1))).toThrow();
  });

  test("stakeToAmount and amountToStake round-trip a positive value", () => {
    const asAmount = stakeToAmount(stake(9));
    expect(asAmount).toBe(9);
    expect(amountToStake(asAmount)).toBe(9);
  });

  test("amountToStake throws on the zero amount", () => {
    expect(() => amountToStake(ZERO_BUCKS)).toThrow();
  });

  test("creditOf and debitOf produce signed non-zero deltas", () => {
    expect(creditOf(stake(7))).toBe(7);
    expect(debitOf(stake(7))).toBe(-7);
    expect(creditOf(amount(7))).toBe(7);
    expect(debitOf(amount(7))).toBe(-7);
  });

  test("creditOf and debitOf throw on the zero amount", () => {
    expect(() => creditOf(ZERO_BUCKS)).toThrow();
    expect(() => debitOf(ZERO_BUCKS)).toThrow();
  });
});

describe("brand non-interchangeability", () => {
  test("distinct brands over the same base type do not extend each other", () => {
    expectTypeOf<BucksStake>().not.toExtend<BucksDelta>();
    expectTypeOf<BucksAmount>().not.toExtend<BucksStake>();
    expectTypeOf<BucksDelta>().not.toExtend<BucksAmount>();
  });

  test("unbranded numbers do not satisfy any money brand", () => {
    expectTypeOf<number>().not.toExtend<BucksStake>();
    expectTypeOf<number>().not.toExtend<BucksAmount>();
    expectTypeOf<number>().not.toExtend<BucksDelta>();
  });

  test("branded values remain plain numbers structurally, e.g. for Prisma writes", () => {
    expectTypeOf<BucksStake>().toExtend<number>();
    expectTypeOf<BucksAmount>().toExtend<number>();
    expectTypeOf<BucksDelta>().toExtend<number>();
  });
});
