import { describe, expect, test } from "vitest";
import { verifyClassifications } from "./verify.ts";
import type { ProposedChange } from "../classifier/types.ts";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function change(overrides: Partial<ProposedChange>): ProposedChange {
  return {
    transactionId: "t1",
    transactionDate: "2026-01-01",
    merchantName: "Apple Card, Cash, and Savings",
    amount: -100,
    currentCategory: "Interest",
    currentCategoryId: "int",
    proposedCategory: "Interest",
    proposedCategoryId: "int",
    confidence: "high",
    type: "recategorize",
    ...overrides,
  };
}

function enriched(
  transactionId: string,
  accountId: string,
): EnrichedTransaction {
  const transaction: MonarchTransaction = {
    id: transactionId,
    amount: -100,
    pending: false,
    date: "2026-01-01",
    hideFromReports: false,
    plaidName: "",
    notes: "",
    isRecurring: false,
    reviewStatus: "reviewed",
    needsReview: false,
    isSplitTransaction: false,
    category: { id: "int", name: "Interest" },
    merchant: {
      id: "m1",
      name: "Apple Card, Cash, and Savings",
      transactionsCount: 2,
    },
    account: { id: accountId, displayName: accountId },
    tags: [],
  };
  return { transaction, enrichment: undefined, tier: 2, deepPath: "regular" };
}

describe("verifyClassifications merchant consistency", () => {
  test("does not flag one merchant name spanning two accounts", () => {
    // Apple Savings interest vs Apple Card payments: the category spread
    // is correct per account, so grouping by merchant name alone floods
    // the review queue.
    const changes = [
      change({ transactionId: "t1", proposedCategory: "Interest" }),
      change({
        transactionId: "t2",
        proposedCategory: "Credit Card Payment",
        proposedCategoryId: "ccp",
      }),
    ];
    const result = verifyClassifications(
      changes,
      [enriched("t1", "savings"), enriched("t2", "card")],
      new Map(),
    );
    expect(result.flagged).toHaveLength(0);
    expect(result.changes).toHaveLength(2);
  });

  test("still flags inconsistent categories within one account", () => {
    const changes = [
      change({ transactionId: "t1", proposedCategory: "Interest" }),
      change({
        transactionId: "t2",
        proposedCategory: "Transfer",
        proposedCategoryId: "xfer",
      }),
    ];
    const result = verifyClassifications(
      changes,
      [enriched("t1", "savings"), enriched("t2", "savings")],
      new Map(),
    );
    expect(result.flagged).toHaveLength(2);
  });
});
