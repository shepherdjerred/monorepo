import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import {
  BucksTransferAmountSchema,
  splitBucksTransferAmount,
} from "#src/betting/accounts/transfer.ts";

describe("splitBucksTransferAmount", () => {
  test.each([
    [2, 1, 1],
    [3, 1, 2],
    [10, 5, 5],
  ])(
    "splits %i BB into %i for the recipient and %i for the house",
    (amount, recipientAmount, feeAmount) => {
      expect(splitBucksTransferAmount(amount)).toEqual({
        recipientAmount,
        feeAmount,
      });
    },
  );

  test("accepts the Int32 maximum and favors the house", () => {
    expect(splitBucksTransferAmount(BUCKS_INT32_MAX)).toEqual({
      recipientAmount: 1_073_741_823,
      feeAmount: 1_073_741_824,
    });
  });

  test.each([1, 2.5, BUCKS_INT32_MAX + 1])(
    "rejects invalid amount %s",
    (amount) => {
      expect(BucksTransferAmountSchema.safeParse(amount).success).toBe(false);
    },
  );
});
