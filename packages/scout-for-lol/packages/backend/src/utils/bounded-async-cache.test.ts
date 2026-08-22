import { describe, expect, test } from "vitest";
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

  test("clears retained and in-flight entries without allowing stale repopulation", async () => {
    const first = Promise.withResolvers<number>();
    const cached = createBoundedAsyncCache<number>({
      ttlMs: 10,
      maxEntries: 2,
      maxConcurrent: 2,
      now: () => 0,
    });

    const stale = cached("a", () => first.promise);
    cached.clear();
    expect(await cached("a", () => Promise.resolve(2))).toBe(2);
    first.resolve(1);
    expect(await stale).toBe(1);
    expect(await cached("a", () => Promise.resolve(3))).toBe(2);
  });
});
