import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
  BUCKS_INT32_MAX,
  BucksAmountSchema,
  BucksDeltaSchema,
  BucksStakeSchema,
  BucksStorageOverflowError,
  StorableBucksAmountSchema,
  StorableBucksDeltaSchema,
  StorableBucksStakeSchema,
  storableAmount,
  storableDelta,
  storableStake,
  type BucksAmount,
  type BucksDelta,
  type BucksStake,
  type StorableBucksAmount,
  type StorableBucksDelta,
  type StorableBucksStake,
} from "./bryan-bucks-money.ts";

const stake = (value: number) => BucksStakeSchema.parse(value);
const amount = (value: number) => BucksAmountSchema.parse(value);
const delta = (value: number) => BucksDeltaSchema.parse(value);

const ACCOUNT_ID = 42;

describe("BUCKS_INT32_MAX", () => {
  test("is exactly the Int32 storage bound Prisma's Int columns enforce", () => {
    expect(BUCKS_INT32_MAX).toBe(2_147_483_647);
  });
});

/**
 * The semantic brands themselves are covered in `@scout-for-lol/domain`, and
 * `domain-reexport-identity.test.ts` proves this module re-exports those exact
 * objects rather than copies. What is asserted here is the split itself.
 */
describe("the split between meaning and storability", () => {
  test("the money brands no longer carry the Int32 bound", () => {
    // The split this module exists for: a legal aggregate above Int32 must
    // parse as money, and only the storable layer may reject it.
    expect(BucksAmountSchema.safeParse(BUCKS_INT32_MAX + 1).success).toBe(true);
    expect(BucksStakeSchema.safeParse(BUCKS_INT32_MAX + 1).success).toBe(true);
    expect(BucksDeltaSchema.safeParse(BUCKS_INT32_MAX + 1).success).toBe(true);
  });
});

describe("storable schemas", () => {
  test.each([
    ["stake", StorableBucksStakeSchema],
    ["amount", StorableBucksAmountSchema],
    ["delta", StorableBucksDeltaSchema],
  ])("the storable %s accepts the Int32 ceiling itself", (_name, schema) => {
    expect(schema.safeParse(BUCKS_INT32_MAX).success).toBe(true);
    expect(schema.safeParse(BUCKS_INT32_MAX + 1).success).toBe(false);
  });

  test("the storable delta bounds both directions", () => {
    expect(
      StorableBucksDeltaSchema.safeParse(0 - BUCKS_INT32_MAX).success,
    ).toBe(true);
    expect(
      StorableBucksDeltaSchema.safeParse(0 - BUCKS_INT32_MAX - 1).success,
    ).toBe(false);
  });

  test("storability is a check, not a refinement, so it survives JSON Schema", () => {
    // The dare contract and paraphrase-corpus JSON Schemas are generated from
    // schemas built on these types. A `.refine` would validate identically
    // and emit nothing, silently dropping the Int32 ceiling from the
    // published contract.
    expect(z.toJSONSchema(StorableBucksStakeSchema)).toMatchObject({
      type: "integer",
      maximum: BUCKS_INT32_MAX,
    });
  });

  test("a storable value is still the plain number Prisma writes", () => {
    expect(StorableBucksAmountSchema.parse(5)).toBe(5);
  });
});

describe("storable helpers", () => {
  test("return the value when the Int column can hold it", () => {
    expect(storableStake(stake(25), ACCOUNT_ID)).toBe(25);
    expect(storableAmount(amount(0), ACCOUNT_ID)).toBe(0);
    expect(storableDelta(delta(-25), ACCOUNT_ID)).toBe(-25);
  });

  test("accept the Int32 boundary exactly", () => {
    expect(storableStake(stake(BUCKS_INT32_MAX), ACCOUNT_ID)).toBe(
      BUCKS_INT32_MAX,
    );
    expect(storableDelta(delta(0 - BUCKS_INT32_MAX), ACCOUNT_ID)).toBe(
      0 - BUCKS_INT32_MAX,
    );
  });

  test("raise the existing overflow error, not a ZodError", () => {
    // Every recovery path — settlement refund retry, dare void, placement
    // rejection — matches on this class. A ZodError here would be re-raised
    // as an unhandled settlement failure instead.
    const over = BUCKS_INT32_MAX + 1;
    expect(() => storableStake(stake(over), ACCOUNT_ID)).toThrow(
      BucksStorageOverflowError,
    );
    expect(() => storableAmount(amount(over), ACCOUNT_ID)).toThrow(
      BucksStorageOverflowError,
    );
    expect(() => storableDelta(delta(over), ACCOUNT_ID)).toThrow(
      BucksStorageOverflowError,
    );
    expect(() => storableDelta(delta(0 - over), ACCOUNT_ID)).toThrow(
      BucksStorageOverflowError,
    );
  });

  test("carry the account whose column could not hold the value", () => {
    try {
      storableAmount(amount(BUCKS_INT32_MAX + 1), ACCOUNT_ID);
      expect.unreachable("the overflow should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(BucksStorageOverflowError);
      if (error instanceof BucksStorageOverflowError) {
        expect(error.bucksAccountId).toBe(ACCOUNT_ID);
      }
    }
  });
});

describe("storable brands", () => {
  test("a storable value is usable wherever its semantic brand is", () => {
    // Subtyping is what keeps the Int32 check from rippling: proving a value
    // storable never forces a conversion on the way back out.
    expectTypeOf<StorableBucksStake>().toExtend<BucksStake>();
    expectTypeOf<StorableBucksAmount>().toExtend<BucksAmount>();
    expectTypeOf<StorableBucksDelta>().toExtend<BucksDelta>();
  });

  test("a semantic value is not automatically storable", () => {
    expectTypeOf<BucksStake>().not.toExtend<StorableBucksStake>();
    expectTypeOf<BucksAmount>().not.toExtend<StorableBucksAmount>();
    expectTypeOf<BucksDelta>().not.toExtend<StorableBucksDelta>();
  });

  test("storability does not blur the semantic brands together", () => {
    expectTypeOf<StorableBucksStake>().not.toExtend<StorableBucksAmount>();
    expectTypeOf<StorableBucksAmount>().not.toExtend<StorableBucksDelta>();
  });
});
