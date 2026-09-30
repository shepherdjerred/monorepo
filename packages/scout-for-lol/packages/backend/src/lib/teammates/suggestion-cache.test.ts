import { describe, expect, test, vi } from "vitest";
import { createSuggestionCache } from "#src/lib/teammates/suggestion-cache.ts";

describe("createSuggestionCache", () => {
  test("shares one in-flight fetch and reuses the settled value", async () => {
    let now = 0;
    const cache = createSuggestionCache<string>({
      ttlMs: 100,
      now: () => now,
    });
    const fetch = vi.fn(async () => "v1");

    const [first, second] = await Promise.all([
      cache.getOrFetch("k", fetch),
      cache.getOrFetch("k", fetch),
    ]);
    expect(first).toBe("v1");
    expect(second).toBe("v1");
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 50;
    expect(await cache.getOrFetch("k", fetch)).toBe("v1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("refetches after the TTL and never caches failures", async () => {
    let now = 0;
    const cache = createSuggestionCache<string>({
      ttlMs: 100,
      now: () => now,
    });
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("v2");

    await expect(cache.getOrFetch("k", fetch)).rejects.toThrow("boom");
    expect(await cache.getOrFetch("k", fetch)).toBe("v2");
    expect(fetch).toHaveBeenCalledTimes(2);

    now = 500;
    const refetch = vi.fn(async () => "v3");
    expect(await cache.getOrFetch("k", refetch)).toBe("v3");
  });
});
