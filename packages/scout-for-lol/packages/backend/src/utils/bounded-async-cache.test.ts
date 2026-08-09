import { describe, expect, test } from "bun:test";
import { createBoundedAsyncCache } from "#src/utils/bounded-async-cache.ts";

describe("createBoundedAsyncCache", () => {
  test("evicts expired entries", async () => {
    let now = 0;
    let loads = 0;
    const cached = createBoundedAsyncCache<number>({
      ttlMs: 10,
      maxEntries: 2,
      maxConcurrent: 1,
      now: () => now,
    });
    const load = () => Promise.resolve(++loads);

    expect(await cached("a", load)).toBe(1);
    expect(await cached("a", load)).toBe(1);
    now = 10;
    expect(await cached("a", load)).toBe(2);
  });

  test("bounds the number of retained entries", async () => {
    let loads = 0;
    const cached = createBoundedAsyncCache<number>({
      ttlMs: 10,
      maxEntries: 2,
      maxConcurrent: 1,
      now: () => 0,
    });
    const load = () => Promise.resolve(++loads);

    await cached("a", load);
    await cached("b", load);
    await cached("c", load);
    expect(await cached("a", load)).toBe(4);
  });
});
