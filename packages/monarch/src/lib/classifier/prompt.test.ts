import { describe, expect, test } from "bun:test";
import {
  buildCategoryList,
  buildMerchantBatchPrompt,
  buildAmazonItemPrompt,
} from "./prompt.ts";
import type { MonarchCategory, MerchantGroup } from "../monarch/types.ts";

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

describe("buildCategoryList", () => {
  test("formats categories with group names", () => {
    const result = buildCategoryList(mockCategories);
    expect(result).toContain("cat-1: Groceries (Food & Drink)");
    expect(result).toContain("cat-2: Electronics (Shopping)");
  });
});

describe("buildMerchantBatchPrompt", () => {
  test("includes merchant details", () => {
    const merchants: MerchantGroup[] = [
      {
        merchantName: "Trader Joe's",
        transactions: [],
        totalAmount: 250,
        count: 5,
        plaidNames: ["TRADER JOES #123"],
        currentCategory: "Shopping",
        currentCategoryId: "cat-2",
      },
    ];

    const prompt = buildMerchantBatchPrompt(mockCategories, merchants);
    expect(prompt).toContain("Trader Joe's");
    expect(prompt).toContain("5 txns");
    expect(prompt).toContain("$250.00");
    expect(prompt).toContain("TRADER JOES #123");
  });

  test("includes all categories", () => {
    const prompt = buildMerchantBatchPrompt(mockCategories, []);
    expect(prompt).toContain("Groceries");
    expect(prompt).toContain("Electronics");
  });
});

describe("buildAmazonItemPrompt", () => {
  test("includes item details with prices", () => {
    const items = [
      { title: "Anker USB-C Hub", price: 29.99 },
      { title: "Dog Food", price: 44.99 },
    ];

    const prompt = buildAmazonItemPrompt(mockCategories, items);
    expect(prompt).toContain("Anker USB-C Hub");
    expect(prompt).toContain("$29.99");
    expect(prompt).toContain("Dog Food");
    expect(prompt).toContain("$44.99");
  });

  test("includes needsSplit instruction", () => {
    const prompt = buildAmazonItemPrompt(mockCategories, []);
    expect(prompt).toContain("needsSplit");
  });
});
