import { describe, expect, test } from "vitest";
import {
  BucksContributionFormSchema,
  bucksStakeFormSchema,
} from "./bucks-forms.ts";

describe("bucks stake form schema", () => {
  const schema = bucksStakeFormSchema(25);

  test("accepts a whole-number stake within balance", () => {
    expect(schema.parse({ side: "100", stake: "10" })).toEqual({
      side: "100",
      stake: 10,
    });
    expect(schema.parse({ side: "YES", stake: " 25 " }).stake).toBe(25);
  });

  test.each([
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "2.5"],
    ["not a number", "ten"],
    ["empty", ""],
  ])("rejects a %s stake", (_label, stake) => {
    expect(schema.safeParse({ side: "100", stake }).success).toBe(false);
  });

  test("rejects a stake above the balance with the balance in the message", () => {
    const result = schema.safeParse({ side: "100", stake: "26" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("25");
    }
  });

  test("rejects a missing side", () => {
    expect(schema.safeParse({ side: "", stake: "5" }).success).toBe(false);
  });
});

describe("BucksContributionFormSchema", () => {
  test("accepts only positive whole BB amounts", () => {
    expect(
      BucksContributionFormSchema.parse({ contributionAmount: "10" }),
    ).toEqual({ contributionAmount: 10 });
    expect(() =>
      BucksContributionFormSchema.parse({ contributionAmount: "1.5" }),
    ).toThrow();
    expect(() =>
      BucksContributionFormSchema.parse({ contributionAmount: "0" }),
    ).toThrow();
  });
});
