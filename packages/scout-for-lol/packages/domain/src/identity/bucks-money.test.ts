import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
  type BucksAmount,
  BucksAmountSchema,
  type BucksDelta,
  BucksDeltaSchema,
  type BucksPoolTotal,
  BucksPoolTotalSchema,
  type BucksStake,
  BucksStakeSchema,
  ZERO_BUCKS,
  addAmounts,
  amountToStake,
  applyDelta,
  creditOf,
  debitOf,
  stakeToAmount,
  subtractAmounts,
  sumToPoolTotal,
} from "#src/identity/bucks-money.ts";

const stake = (value: number) => BucksStakeSchema.parse(value);
const amount = (value: number) => BucksAmountSchema.parse(value);
const delta = (value: number) => BucksDeltaSchema.parse(value);

/** The Int32 bound these brands deliberately no longer carry. Named here only
 * so the tests can assert values above it still parse. */
const INT32_MAX = 2_147_483_647;

describe("BucksStakeSchema", () => {
  test.each([1, 25, INT32_MAX, INT32_MAX + 1, Number.MAX_SAFE_INTEGER])(
    "accepts %d",
    (value) => {
      expect(BucksStakeSchema.parse(value)).toBe(value);
    },
  );

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %d",
    (value) => {
      expect(BucksStakeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("BucksAmountSchema", () => {
  test.each([0, 1, INT32_MAX + 1, Number.MAX_SAFE_INTEGER])(
    "accepts %d",
    (value) => {
      expect(BucksAmountSchema.parse(value)).toBe(value);
    },
  );

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %d",
    (value) => {
      expect(BucksAmountSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("BucksDeltaSchema", () => {
  test.each([
    1,
    -1,
    INT32_MAX + 1,
    -(INT32_MAX + 1),
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ])("accepts %d", (value) => {
    expect(BucksDeltaSchema.parse(value)).toBe(value);
  });

  test.each([0, 2.5, Number.NaN, Number.NEGATIVE_INFINITY])(
    "rejects %d",
    (value) => {
      expect(BucksDeltaSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("BucksPoolTotalSchema", () => {
  test("accepts an aggregate no single storage column could hold", () => {
    // The case that forced pool aggregates back to bare `number` before the
    // semantic brands were split from Int32 storability.
    expect(BucksPoolTotalSchema.parse(INT32_MAX * 2)).toBe(INT32_MAX * 2);
  });

  test.each([-1, 0.5, Number.NaN])("rejects %d", (value) => {
    expect(BucksPoolTotalSchema.safeParse(value).success).toBe(false);
  });
});

describe("safe-integer bounds", () => {
  // `z.number().int()` refuses anything outside the safe-integer range, so a
  // sum that has already lost precision can never acquire a brand.
  test.each([
    ["stake", BucksStakeSchema],
    ["amount", BucksAmountSchema],
    ["delta", BucksDeltaSchema],
    ["pool total", BucksPoolTotalSchema],
  ])("the %s brand stops at MAX_SAFE_INTEGER", (_name, schema) => {
    expect(schema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(schema.safeParse(Number.MAX_SAFE_INTEGER + 2).success).toBe(false);
  });
});

describe("checked arithmetic", () => {
  test("addAmounts sums and stays branded", () => {
    expect(addAmounts(amount(3), amount(4), amount(0))).toBe(7);
  });

  test("addAmounts no longer stops at Int32", () => {
    expect(addAmounts(amount(INT32_MAX), amount(1))).toBe(INT32_MAX + 1);
  });

  test("addAmounts throws a ZodError when the sum stops being exact", () => {
    expect(() =>
      addAmounts(amount(Number.MAX_SAFE_INTEGER), amount(2)),
    ).toThrow(z.ZodError);
  });

  test("subtractAmounts subtracts", () => {
    expect(subtractAmounts(amount(10), amount(4))).toBe(6);
  });

  test("subtractAmounts throws a ZodError when the result would be negative", () => {
    expect(() => subtractAmounts(amount(4), amount(10))).toThrow(z.ZodError);
  });

  test("applyDelta credits and debits", () => {
    expect(applyDelta(amount(10), delta(5))).toBe(15);
    expect(applyDelta(amount(10), delta(-10))).toBe(0);
  });

  test("applyDelta throws a ZodError when the result would be negative", () => {
    expect(() => applyDelta(amount(3), delta(-4))).toThrow(z.ZodError);
  });

  test("stakeToAmount and amountToStake round-trip a positive value", () => {
    const asAmount = stakeToAmount(stake(9));
    expect(asAmount).toBe(9);
    expect(amountToStake(asAmount)).toBe(9);
  });

  test("amountToStake throws a ZodError on the zero amount", () => {
    expect(() => amountToStake(ZERO_BUCKS)).toThrow(z.ZodError);
  });

  test("creditOf and debitOf produce signed non-zero deltas", () => {
    expect(creditOf(stake(7))).toBe(7);
    expect(debitOf(stake(7))).toBe(-7);
    expect(creditOf(amount(7))).toBe(7);
    expect(debitOf(amount(7))).toBe(-7);
  });

  test("creditOf and debitOf throw a ZodError on the zero amount", () => {
    expect(() => creditOf(ZERO_BUCKS)).toThrow(z.ZodError);
    expect(() => debitOf(ZERO_BUCKS)).toThrow(z.ZodError);
  });
});

describe("sumToPoolTotal", () => {
  test("sums per-account positions", () => {
    expect(sumToPoolTotal([amount(3), amount(4), amount(0)])).toBe(7);
  });

  test("the empty pool totals zero", () => {
    expect(sumToPoolTotal([])).toBe(0);
  });

  test("aggregates past Int32 without complaint", () => {
    const half = amount(INT32_MAX);
    expect(sumToPoolTotal([half, half])).toBe(INT32_MAX * 2);
  });
});

describe("brand non-interchangeability", () => {
  test("distinct brands over the same base type do not extend each other", () => {
    expectTypeOf<BucksStake>().not.toExtend<BucksDelta>();
    expectTypeOf<BucksAmount>().not.toExtend<BucksStake>();
    expectTypeOf<BucksDelta>().not.toExtend<BucksAmount>();
  });

  test("a pool total is not one account's amount, and vice versa", () => {
    // The pair that matters most: aggregates and per-account values are both
    // non-negative integers, so only the brands keep a multi-bettor sum out
    // of a field destined for one bettor's storage column.
    expectTypeOf<BucksPoolTotal>().not.toExtend<BucksAmount>();
    expectTypeOf<BucksAmount>().not.toExtend<BucksPoolTotal>();
    expectTypeOf<BucksPoolTotal>().not.toExtend<BucksStake>();
    expectTypeOf<BucksStake>().not.toExtend<BucksPoolTotal>();
  });

  test("unbranded numbers do not satisfy any money brand", () => {
    expectTypeOf<number>().not.toExtend<BucksStake>();
    expectTypeOf<number>().not.toExtend<BucksAmount>();
    expectTypeOf<number>().not.toExtend<BucksDelta>();
    expectTypeOf<number>().not.toExtend<BucksPoolTotal>();
  });

  test("branded values remain plain numbers structurally, e.g. for Prisma writes", () => {
    expectTypeOf<BucksStake>().toExtend<number>();
    expectTypeOf<BucksAmount>().toExtend<number>();
    expectTypeOf<BucksDelta>().toExtend<number>();
    expectTypeOf<BucksPoolTotal>().toExtend<number>();
  });
});
