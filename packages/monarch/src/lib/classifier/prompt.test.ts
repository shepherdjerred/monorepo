import { describe, expect, test } from "bun:test";
import {
  buildCategoryList,
  buildWeekPrompt,
  buildAmazonBatchPrompt,
} from "./prompt.ts";
import type { MonarchCategory } from "../monarch/types.ts";
import type { WeekWindow } from "../monarch/weeks.ts";
import type { ResolvedTransaction } from "../enrichment.ts";

const mockCategories: MonarchCategory[] = [
  {
    id: "cat-1",
    name: "Groceries",
    order: 1,
    isSystemCategory: false,
    isDisabled: false,
    group: { id: "g-1", name: "Food & Drink", type: "expense" },
  },
  {
    id: "cat-2",
    name: "Electronics",
    order: 2,
    isSystemCategory: false,
    isDisabled: false,
    group: { id: "g-2", name: "Shopping", type: "expense" },
  },
];

const mockTxn = {
  id: "t-1",
  amount: -50,
  pending: false,
  date: "2026-02-17",
  hideFromReports: false,
  plaidName: "TRADER JOES #123",
  notes: "",
  isRecurring: false,
  reviewStatus: "",
  needsReview: false,
  isSplitTransaction: false,
  createdAt: "2026-02-17T00:00:00Z",
  updatedAt: "2026-02-17T00:00:00Z",
  category: { id: "cat-2", name: "Shopping" },
  merchant: { id: "m-1", name: "Trader Joe's", transactionsCount: 5 },
  account: { id: "a-1", displayName: "Checking" },
  tags: [],
};

describe("buildCategoryList", () => {
  test("formats categories with group names", () => {
    const result = buildCategoryList(mockCategories);
    expect(result).toContain("cat-1: Groceries (Food & Drink)");
    expect(result).toContain("cat-2: Electronics (Shopping)");
  });
});

describe("buildWeekPrompt", () => {
  test("marks current week transactions with [CLASSIFY]", () => {
    const window: WeekWindow = {
      previous: undefined,
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [mockTxn],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      new Map(),
      new Map(),
    );
    expect(prompt).toContain("[CLASSIFY]");
    expect(prompt).toContain("Trader Joe's");
    expect(prompt).toContain("TRADER JOES #123");
    expect(prompt).toContain("current: Shopping");
    expect(prompt).toContain("THIS WEEK");
  });

  test("shows resolved transactions with [RESOLVED]", () => {
    const resolvedMap = new Map<string, ResolvedTransaction>([
      ["t-1", { transactionId: "t-1", category: "Groceries" }],
    ]);

    const window: WeekWindow = {
      previous: undefined,
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [mockTxn],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      resolvedMap,
      new Map(),
    );
    expect(prompt).toContain("[RESOLVED → Groceries]");
    // The transaction line should not have [CLASSIFY] — only [RESOLVED]
    const txnLines = prompt.split("\n").filter((l) => l.includes("Trader Joe's"));
    expect(txnLines.every((l) => !l.includes("[CLASSIFY]"))).toBe(true);
  });

  test("shows resolved splits with detail", () => {
    const resolvedMap = new Map<string, ResolvedTransaction>([
      [
        "t-1",
        {
          transactionId: "t-1",
          category: "SPLIT",
          detail: "USB Hub → Electronics, Dog Food → Pets",
        },
      ],
    ]);

    const window: WeekWindow = {
      previous: undefined,
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [mockTxn],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      resolvedMap,
      new Map(),
    );
    expect(prompt).toContain("[RESOLVED → SPLIT]");
    expect(prompt).toContain("USB Hub → Electronics, Dog Food → Pets");
  });

  test("shows previous and next weeks as [CONTEXT]", () => {
    const prevTxn = { ...mockTxn, id: "t-prev", date: "2026-02-10" };
    const nextTxn = { ...mockTxn, id: "t-next", date: "2026-02-24" };

    const window: WeekWindow = {
      previous: {
        weekKey: "2026-W07",
        startDate: "2026-02-09",
        endDate: "2026-02-15",
        transactions: [prevTxn],
      },
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [mockTxn],
      },
      next: {
        weekKey: "2026-W09",
        startDate: "2026-02-23",
        endDate: "2026-03-01",
        transactions: [nextTxn],
      },
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      new Map(),
      new Map(),
    );
    expect(prompt).toContain("PREVIOUS WEEK");
    expect(prompt).toContain("[CONTEXT]");
    expect(prompt).toContain("NEXT WEEK");
    expect(prompt).toContain("THIS WEEK");
  });

  test("uses previous results for context week categories", () => {
    const prevTxn = { ...mockTxn, id: "t-prev", date: "2026-02-10" };
    const previousResults = new Map([["t-prev", "Groceries"]]);

    const window: WeekWindow = {
      previous: {
        weekKey: "2026-W07",
        startDate: "2026-02-09",
        endDate: "2026-02-15",
        transactions: [prevTxn],
      },
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [mockTxn],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      new Map(),
      previousResults,
    );
    // Previous week should show the classified category from previousResults
    expect(prompt).toContain("Groceries");
  });

  test("includes all categories", () => {
    const window: WeekWindow = {
      previous: undefined,
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      new Map(),
      new Map(),
    );
    expect(prompt).toContain("Groceries");
    expect(prompt).toContain("Electronics");
  });

  test("includes JSON response format", () => {
    const window: WeekWindow = {
      previous: undefined,
      current: {
        weekKey: "2026-W08",
        startDate: "2026-02-16",
        endDate: "2026-02-22",
        transactions: [],
      },
      next: undefined,
    };

    const prompt = buildWeekPrompt(
      mockCategories,
      window,
      new Map(),
      new Map(),
    );
    expect(prompt).toContain("transactionId");
    expect(prompt).toContain("categoryId");
    expect(prompt).toContain("confidence");
  });
});

describe("buildAmazonBatchPrompt", () => {
  test("includes item details with prices", () => {
    const orders = [
      {
        orderIndex: 0,
        items: [
          { title: "Anker USB-C Hub", price: 29.99 },
          { title: "Dog Food", price: 44.99 },
        ],
      },
    ];

    const prompt = buildAmazonBatchPrompt(mockCategories, orders);
    expect(prompt).toContain("Anker USB-C Hub");
    expect(prompt).toContain("$29.99");
    expect(prompt).toContain("Dog Food");
    expect(prompt).toContain("$44.99");
    expect(prompt).toContain("Order #0");
  });

  test("includes needsSplit instruction", () => {
    const prompt = buildAmazonBatchPrompt(mockCategories, []);
    expect(prompt).toContain("needsSplit");
  });

  test("includes multiple orders", () => {
    const orders = [
      { orderIndex: 0, items: [{ title: "Item A", price: 10 }] },
      { orderIndex: 1, items: [{ title: "Item B", price: 20 }] },
    ];

    const prompt = buildAmazonBatchPrompt(mockCategories, orders);
    expect(prompt).toContain("Order #0");
    expect(prompt).toContain("Order #1");
    expect(prompt).toContain("Item A");
    expect(prompt).toContain("Item B");
  });
});
