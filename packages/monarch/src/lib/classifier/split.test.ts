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

  test("rounds to cents and sums exactly to target", () => {
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

    // Must sum exactly to target
    const sum = result.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect(sum).toBe(3100);
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
    // Should round and adjust to sum exactly to 50
    const sum = result.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect(sum).toBe(5000);
  });

  test("fixes rounding drift with many items", () => {
    // Simulate a real-world case: items don't sum to total, proration causes rounding drift
    const items = [
      { amount: 30.99, categoryId: "cat-1", itemName: "Item A", categoryName: "A" },
      { amount: 8.82, categoryId: "cat-2", itemName: "Item B", categoryName: "B" },
      { amount: 24.79, categoryId: "cat-3", itemName: "Item C", categoryName: "C" },
    ];

    // Total is $69.99 but items sum to $64.60 — $5.39 of tax/shipping
    const result = computeSplits(-69.99, items);

    const sumCents = result.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect(sumCents).toBe(6999);

    for (const r of result) {
      const cents = Math.round(r.amount * 100);
      expect(r.amount).toBe(cents / 100);
    }
  });

  test("handles 7-item split with tax proration", () => {
    // Real-world: 7 items with tax making total differ from item sum
    const items = [
      { amount: 12.99, categoryId: "c1", itemName: "A", categoryName: "A" },
      { amount: 8.49, categoryId: "c2", itemName: "B", categoryName: "B" },
      { amount: 15.99, categoryId: "c3", itemName: "C", categoryName: "C" },
      { amount: 6.99, categoryId: "c4", itemName: "D", categoryName: "D" },
      { amount: 22.49, categoryId: "c5", itemName: "E", categoryName: "E" },
      { amount: 3.99, categoryId: "c6", itemName: "F", categoryName: "F" },
      { amount: 11.99, categoryId: "c7", itemName: "G", categoryName: "G" },
    ];

    const result = computeSplits(-91.23, items);

    const sumCents = result.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    expect(sumCents).toBe(9123);
  });
});
