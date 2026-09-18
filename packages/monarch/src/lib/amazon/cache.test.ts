import { describe, expect, test } from "vitest";
import { mergeOrders, AmazonCacheSchema } from "./cache.ts";
import type { AmazonOrder } from "./types.ts";

function order(
  orderId: string,
  date: string,
  overrides: Partial<AmazonOrder> = {},
): AmazonOrder {
  return {
    orderId,
    date,
    total: 25,
    items: [
      { title: "Widget", price: 25, quantity: 1, orderDate: date, orderId },
    ],
    charges: [{ date, amount: 25, description: "Visa ending in 1234" }],
    ...overrides,
  };
}

describe("mergeOrders", () => {
  test("a single-year scrape never discards other years", () => {
    // The regression this module exists for: scraping 2021 alone used to
    // replace the whole cache and destroy 2025-2026.
    const existing = [order("a", "2025-06-01"), order("b", "2026-02-01")];
    const scraped = [order("c", "2021-03-01")];

    const merged = mergeOrders(existing, scraped);
    expect(merged.map((o) => o.orderId).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((o) => o.orderId === "a")?.charges).toHaveLength(1);
  });

  test("inserts new orders and leaves untouched ones alone", () => {
    const existing = [order("a", "2025-06-01")];
    const merged = mergeOrders(existing, [order("b", "2025-07-01")]);
    expect(merged).toHaveLength(2);
    expect(merged.find((o) => o.orderId === "a")).toEqual(existing[0]);
  });

  test("unions charges and dedupes identical ones", () => {
    const existing = [order("a", "2025-06-01")];
    const scraped = [
      order("a", "2025-06-01", {
        charges: [
          {
            date: "2025-06-01",
            amount: 25,
            description: "Visa ending in 1234",
          },
          {
            date: "2025-06-03",
            amount: 10,
            description: "Visa ending in 1234",
          },
        ],
      }),
    ];
    const merged = mergeOrders(existing, scraped);
    expect(merged[0]?.charges).toHaveLength(2);
  });

  test("a richer item list wins in either direction", () => {
    const placeholder = order("a", "2025-06-01", {
      items: [
        {
          title: "Unknown Amazon Purchase",
          price: 25,
          quantity: 1,
          orderDate: "2025-06-01",
          orderId: "a",
        },
      ],
    });
    const real = order("a", "2025-06-01");

    expect(mergeOrders([placeholder], [real])[0]?.items[0]?.title).toBe(
      "Widget",
    );
    expect(mergeOrders([real], [placeholder])[0]?.items[0]?.title).toBe(
      "Widget",
    );
  });

  test("output round-trips through the cache schema", () => {
    const merged = mergeOrders(
      [order("a", "2025-06-01")],
      [order("b", "2021-01-01")],
    );
    expect(() =>
      AmazonCacheSchema.parse({
        version: 2,
        scrapedAt: new Date().toISOString(),
        orders: merged,
      }),
    ).not.toThrow();
  });

  test("sorts newest first for stable file diffs", () => {
    const merged = mergeOrders(
      [order("old", "2021-01-01")],
      [order("new", "2026-01-01")],
    );
    expect(merged.map((o) => o.orderId)).toEqual(["new", "old"]);
  });
});
