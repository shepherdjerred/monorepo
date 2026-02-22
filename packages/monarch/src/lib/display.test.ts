import { describe, expect, test } from "bun:test";
import { displaySummary } from "./display.ts";
import type { ProposedChange } from "./classifier/types.ts";
import type { MonarchTransaction } from "./monarch/types.ts";
import type { AmazonOrder } from "./amazon/types.ts";

function makeChange(
  overrides: Partial<ProposedChange> = {},
): ProposedChange {
  return {
    transactionId: "txn-1",
    transactionDate: "2025-01-15",
    merchantName: "Test Merchant",
    amount: -50,
    currentCategory: "Shopping",
    currentCategoryId: "cat-1",
    proposedCategory: "Groceries",
    proposedCategoryId: "cat-2",
    confidence: "high",
    type: "recategorize",
    ...overrides,
  };
}

const stubTransaction: MonarchTransaction = {
  id: "txn-stub",
  amount: -10,
  pending: false,
  date: "2025-01-01",
  hideFromReports: false,
  plaidName: "",
  notes: "",
  isRecurring: false,
  reviewStatus: "none",
  needsReview: false,
  isSplitTransaction: false,
  createdAt: "2025-01-01",
  updatedAt: "2025-01-01",
  category: { id: "c", name: "Cat" },
  merchant: { id: "m", name: "Merch", transactionsCount: 1 },
  account: { id: "a", displayName: "Acct" },
  tags: [],
};

const stubOrder: AmazonOrder = {
  orderId: "o-stub",
  date: "2025-01-01",
  total: 10,
  items: [],
};

describe("displaySummary", () => {
  test("counts recategorizations correctly", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const weekChanges = [
      makeChange(),
      makeChange({ transactionId: "txn-2" }),
    ];

    displaySummary({ totalTransactions: 100, weekChanges, amazonChanges: [], venmoChanges: [], biltChanges: [], matchResult: null, venmoMatchResult: null, usaaChanges: [], sclChanges: [], appleChanges: [], costcoChanges: [], appleMatchResult: null, costcoMatchResult: null });

    console.log = originalLog;

    const summaryLine = logs.find((l) => l.includes("Re-categorizations"));
    expect(summaryLine).toContain("2");
  });

  test("counts splits correctly", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const amazonChanges = [
      makeChange({
        type: "split",
        splits: [
          {
            itemName: "A",
            amount: 20,
            categoryId: "c1",
            categoryName: "Electronics",
          },
          {
            itemName: "B",
            amount: 30,
            categoryId: "c2",
            categoryName: "Pets",
          },
        ],
      }),
    ];

    displaySummary({ totalTransactions: 100, weekChanges: [], amazonChanges, venmoChanges: [], biltChanges: [], matchResult: null, venmoMatchResult: null, usaaChanges: [], sclChanges: [], appleChanges: [], costcoChanges: [], appleMatchResult: null, costcoMatchResult: null });

    console.log = originalLog;

    const splitsLine = logs.find((l) => l.includes("Splits proposed"));
    expect(splitsLine).toContain("1");
  });

  test("includes Amazon match rate when provided", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    displaySummary({
      totalTransactions: 100,
      weekChanges: [],
      amazonChanges: [],
      venmoChanges: [],
      biltChanges: [],
      matchResult: {
        matched: [
          {
            transaction: stubTransaction,
            order: stubOrder,
            matchType: "exact",
          },
        ],
        unmatchedTransactions: [stubTransaction],
        unmatchedOrders: [],
      },
      venmoMatchResult: null,
      usaaChanges: [],
      sclChanges: [],
      appleChanges: [],
      costcoChanges: [],
      appleMatchResult: null,
      costcoMatchResult: null,
    });

    console.log = originalLog;

    const matchLine = logs.find((l) => l.includes("Amazon match rate"));
    expect(matchLine).toContain("1/2");
  });

  test("counts flagged for review", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    const changes = [
      makeChange({ type: "flag" }),
      makeChange({ type: "flag", transactionId: "txn-2" }),
    ];

    displaySummary({ totalTransactions: 100, weekChanges: changes, amazonChanges: [], venmoChanges: [], biltChanges: [], matchResult: null, venmoMatchResult: null, usaaChanges: [], sclChanges: [], appleChanges: [], costcoChanges: [], appleMatchResult: null, costcoMatchResult: null });

    console.log = originalLog;

    const flagLine = logs.find((l) => l.includes("Flagged for review"));
    expect(flagLine).toContain("2");
  });
});
