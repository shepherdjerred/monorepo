import { describe, expect, test } from "bun:test";
import { computeSplits } from "./claude.ts";

describe("computeSplits", () => {
  test("no proration when items sum to transaction total", () => {
    const items = [
      { amount: 20, categoryId: "cat-1", itemName: "Item A", categoryName: "Electronics" },
      { amount: 30, categoryId: "cat-2", itemName: "Item B", categoryName: "Pets" },
    ];

    const result = computeSplits(-50, items);
    expect(result[0]?.amount).toBe(20);
    expect(result[1]?.amount).toBe(30);
  });

  test("prorates tax/shipping proportionally", () => {
    const items = [
      { amount: 20, categoryId: "cat-1", itemName: "Item A", categoryName: "Electronics" },
      { amount: 30, categoryId: "cat-2", itemName: "Item B", categoryName: "Pets" },
    ];

    const result = computeSplits(-55, items);

    expect(result[0]?.amount).toBe(22);
    expect(result[1]?.amount).toBe(33);
    const total = (result[0]?.amount ?? 0) + (result[1]?.amount ?? 0);
    expect(total).toBe(55);
  });

  test("rounds to cents", () => {
    const items = [
      { amount: 10, categoryId: "cat-1", itemName: "Item A", categoryName: "A" },
      { amount: 10, categoryId: "cat-2", itemName: "Item B", categoryName: "B" },
      { amount: 10, categoryId: "cat-3", itemName: "Item C", categoryName: "C" },
    ];

    const result = computeSplits(-31, items);

    for (const r of result) {
      const cents = Math.round(r.amount * 100);
      expect(r.amount).toBe(cents / 100);
    }
  });

  test("single-category items are returned as-is", () => {
    const items = [
      { amount: 25, categoryId: "cat-1", itemName: "Item A", categoryName: "Electronics" },
    ];

    const result = computeSplits(-25, items);
    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe(25);
  });

  test("handles near-zero remainder", () => {
    const items = [
      { amount: 25.005, categoryId: "cat-1", itemName: "Item A", categoryName: "A" },
      { amount: 24.995, categoryId: "cat-2", itemName: "Item B", categoryName: "B" },
    ];

    const result = computeSplits(-50, items);
    expect(result[0]?.amount).toBe(25.005);
    expect(result[1]?.amount).toBe(24.995);
  });
});
