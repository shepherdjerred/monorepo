import { describe, expect, test } from "vitest";
import {
  foldTransactionRows,
  type TransactionRow,
} from "./transactions-parser.ts";

function dateRow(text: string): TransactionRow {
  return { kind: "date", text };
}

function txnRow(
  amountText: string,
  orderText = "Order #112-1234567-1234567",
  paymentMethod = "Amazon Visa ending in 8620",
): TransactionRow {
  return { kind: "txn", amountText, paymentMethod, orderText };
}

describe("foldTransactionRows", () => {
  test("groups charges under the preceding date header", () => {
    const folded = foldTransactionRows([
      dateRow("September 13, 2026"),
      txnRow("-$213.77"),
      dateRow("September 10, 2026"),
      txnRow("-$49.30", "Order #112-7654321-7654321"),
    ]);

    expect(folded.byOrder.get("112-1234567-1234567")).toEqual([
      {
        date: "2026-09-13",
        amount: 213.77,
        description: "Amazon Visa ending in 8620",
      },
    ]);
    expect(folded.byOrder.get("112-7654321-7654321")?.[0]?.date).toBe(
      "2026-09-10",
    );
    expect(folded.oldestDate).toBe("2026-09-10");
  });

  test("negative page amounts are charges, unsigned amounts are refunds", () => {
    const folded = foldTransactionRows([
      dateRow("August 8, 2026"),
      txnRow("-$100.00"),
      txnRow("$25.00"),
    ]);

    const charges = folded.byOrder.get("112-1234567-1234567");
    expect(charges?.map((c) => c.amount)).toEqual([100, -25]);
  });

  test("skips gift-card-funded movements", () => {
    const folded = foldTransactionRows([
      dateRow("August 8, 2026"),
      txnRow("-$49.30", "Order #112-1234567-1234567", "Amazon Gift Card"),
    ]);

    expect(folded.byOrder.size).toBe(0);
    expect(folded.skippedGiftCard).toBe(1);
  });

  test("skips rows without an order id", () => {
    const folded = foldTransactionRows([
      dateRow("August 8, 2026"),
      txnRow("-$14.99", "Prime Video Channels"),
    ]);

    expect(folded.byOrder.size).toBe(0);
    expect(folded.skippedNoOrder).toBe(1);
  });

  test("collects multiple charges for a split-shipment order", () => {
    const folded = foldTransactionRows([
      dateRow("June 7, 2026"),
      txnRow("-$100.00", "Order #112-1111111-1111111"),
      dateRow("June 9, 2026"),
      txnRow("-$405.84", "Order #112-1111111-1111111"),
    ]);

    expect(folded.byOrder.get("112-1111111-1111111")).toHaveLength(2);
  });

  test("handles thousands separators", () => {
    const folded = foldTransactionRows([
      dateRow("January 3, 2026"),
      txnRow("-$1,234.56"),
    ]);

    expect(folded.byOrder.get("112-1234567-1234567")?.[0]?.amount).toBe(
      1234.56,
    );
  });

  test("ignores transactions before any date header", () => {
    const folded = foldTransactionRows([txnRow("-$10.00")]);
    expect(folded.byOrder.size).toBe(0);
  });
});
