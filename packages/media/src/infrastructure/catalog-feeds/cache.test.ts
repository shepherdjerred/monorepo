import { expect, test, vi } from "vitest";
import type { CatalogFeed } from "#shared/catalog/contract.ts";
import { CATALOG_FEED_TTL_MS, CatalogFeedCache } from "./cache.ts";

function clocked() {
  const clock = { now: 5_000_000 };
  let loads = 0;
  const load = vi.fn((feed: CatalogFeed, page: number) =>
    Promise.resolve(`${feed}:${String(page)}#${String(++loads)}`),
  );
  return { clock, load, cache: new CatalogFeedCache(load, () => clock.now) };
}

test("a feed page is served from memory until six hours have passed, then loaded again on the next read", async () => {
  const { clock, load, cache } = clocked();
  expect(await cache.get("trending", 1)).toBe("trending:1#1");
  clock.now += CATALOG_FEED_TTL_MS - 1;
  expect(await cache.get("trending", 1)).toBe("trending:1#1");
  expect(load).toHaveBeenCalledOnce();
  clock.now += 1;
  expect(await cache.get("trending", 1)).toBe("trending:1#2");
  // The reload restarts the six hours from when it finished.
  clock.now += CATALOG_FEED_TTL_MS - 1;
  expect(await cache.get("trending", 1)).toBe("trending:1#2");
  expect(load).toHaveBeenCalledTimes(2);
});

test("each feed and page is held separately", async () => {
  const { load, cache } = clocked();
  expect(await cache.get("trending", 1)).toBe("trending:1#1");
  expect(await cache.get("trending", 2)).toBe("trending:2#2");
  expect(await cache.get("popular_movies", 1)).toBe("popular_movies:1#3");
  expect(await cache.get("trending", 2)).toBe("trending:2#2");
  expect(load).toHaveBeenCalledTimes(3);
});

test("readers arriving during a load share it instead of starting their own", async () => {
  const pending = Promise.withResolvers<string>();
  const load = vi.fn(() => pending.promise);
  const cache = new CatalogFeedCache(load, () => 0);
  const readers = [
    cache.get("on_the_air", 3),
    cache.get("on_the_air", 3),
    cache.get("on_the_air", 3),
  ];
  pending.resolve("page");
  expect(await Promise.all(readers)).toEqual(["page", "page", "page"]);
  expect(await cache.get("on_the_air", 3)).toBe("page");
  expect(load).toHaveBeenCalledExactlyOnceWith("on_the_air", 3);
});

test("a loader that throws before returning a promise leaves no stuck load behind", async () => {
  const load = vi
    .fn<(feed: CatalogFeed, page: number) => Promise<string>>()
    .mockImplementationOnce(() => {
      throw new Error("refused");
    })
    .mockResolvedValue("recovered");
  const cache = new CatalogFeedCache(load, () => 0);
  await expect(cache.get("trending", 1)).rejects.toThrow("refused");
  expect(await cache.get("trending", 1)).toBe("recovered");
});

test("a failed load reaches every waiting reader and is not kept", async () => {
  const pending = Promise.withResolvers<string>();
  const load = vi
    .fn<(feed: CatalogFeed, page: number) => Promise<string>>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue("recovered");
  const cache = new CatalogFeedCache(load, () => 0);
  const readers = [cache.get("trending", 1), cache.get("trending", 1)];
  pending.reject(new Error("upstream"));
  expect(await Promise.allSettled(readers)).toMatchObject([
    { status: "rejected", reason: { message: "upstream" } },
    { status: "rejected", reason: { message: "upstream" } },
  ]);
  expect(await cache.get("trending", 1)).toBe("recovered");
  expect(load).toHaveBeenCalledTimes(2);
});

test("an expired page is not served when its reload fails, and the next read tries again", async () => {
  const { clock, load, cache } = clocked();
  await cache.get("trending", 1);
  clock.now += CATALOG_FEED_TTL_MS;
  load.mockRejectedValueOnce(new Error("upstream"));
  await expect(cache.get("trending", 1)).rejects.toThrow("upstream");
  expect(await cache.get("trending", 1)).toBe("trending:1#2");
  expect(load).toHaveBeenCalledTimes(3);
});

test("a page outside the bounded set is refused before anything is loaded", async () => {
  const { load, cache } = clocked();
  for (const page of [0, 6, 1.5, Number.NaN])
    await expect(cache.get("trending", page)).rejects.toThrow(
      "outside the cached range",
    );
  expect(load).not.toHaveBeenCalled();
});
