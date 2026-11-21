import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { IntegrationError } from "#integrations/http.ts";
import {
  artworkFixture,
  jpeg,
  POSTER,
  posterName,
  removeArtworkFixtures,
} from "./artwork.test-support.ts";

afterEach(removeArtworkFixtures);

const unavailable = { code: "artwork_unavailable", status: 502 };
const notFound = { code: "artwork_not_found", status: 404 };

describe("artwork proxy", () => {
  test("fetches a miss once, stores it, and then serves it without TMDB", async () => {
    const { proxy, fetched } = await artworkFixture();
    const artwork = { bytes: jpeg(), contentType: "image/jpeg" };
    expect(await proxy.read("w342", POSTER)).toEqual(artwork);
    fetched.mockRejectedValue(
      new IntegrationError("tmdb-images", "unavailable"),
    );
    expect(await proxy.read("w342", POSTER)).toEqual(artwork);
    expect(fetched).toHaveBeenCalledExactlyOnceWith("w342", POSTER);
    expect(proxy.metrics()).toContain(
      'media_artwork_requests_total{outcome="hit"} 1\n' +
        'media_artwork_requests_total{outcome="miss"} 1\n',
    );
    expect(proxy.metrics()).toContain(
      "media_artwork_cache_entries 1\n# TYPE media_artwork_cache_bytes gauge\nmedia_artwork_cache_bytes 32\n",
    );
  });

  test("shares one upstream fetch between concurrent requests for a key", async () => {
    const { proxy, fetched } = await artworkFixture();
    const results = await Promise.all(
      Array.from({ length: 24 }, () => proxy.read("w500", POSTER)),
    );
    expect(results.every((result) => result.bytes.byteLength === 32)).toBe(
      true,
    );
    expect(fetched).toHaveBeenCalledOnce();
  });

  test("runs at most six upstream fetches at once and refuses work past the queue", async () => {
    const { proxy, fetched, log } = await artworkFixture();
    // The test opens this latch to let every held upstream fetch finish.
    const { promise: opened, resolve: open } = Promise.withResolvers<"open">();
    let active = 0;
    let peak = 0;
    fetched.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await opened;
      active -= 1;
      return { status: "found", bytes: jpeg(), contentType: "image/jpeg" };
    });
    const accepted = Array.from({ length: 6 + 256 }, (_, index) =>
      proxy.read("w185", posterName(index)),
    );
    await expect(proxy.read("w185", posterName(999))).rejects.toMatchObject(
      unavailable,
    );
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: "media_artwork_upstream_saturated",
      key: `w185/${posterName(999)}`,
    });
    expect(active).toBe(6);
    open("open");
    await Promise.all(accepted);
    expect(peak).toBe(6);
    expect(fetched).toHaveBeenCalledTimes(6 + 256);
  });

  test("remembers an upstream 404 for ten minutes without a timer", async () => {
    const { proxy, fetched, clock } = await artworkFixture();
    fetched.mockResolvedValue({ status: "missing" });
    await expect(proxy.read("w342", POSTER)).rejects.toMatchObject(notFound);
    clock.now += 10 * 60 * 1000 - 1;
    await expect(proxy.read("w342", POSTER)).rejects.toMatchObject(notFound);
    expect(fetched).toHaveBeenCalledOnce();
    clock.now += 1;
    await expect(proxy.read("w342", POSTER)).rejects.toMatchObject(notFound);
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(proxy.metrics()).toContain(
      'media_artwork_requests_total{outcome="not_found"} 3\n',
    );
  });

  test("bounds the remembered 404s by forgetting the oldest", async () => {
    const { proxy, fetched } = await artworkFixture();
    fetched.mockResolvedValue({ status: "missing" });
    for (let index = 0; index <= 1024; index += 1)
      await expect(proxy.read("w342", posterName(index))).rejects.toMatchObject(
        notFound,
      );
    await expect(proxy.read("w342", posterName(1))).rejects.toMatchObject(
      notFound,
    );
    expect(fetched).toHaveBeenCalledTimes(1025);
    await expect(proxy.read("w342", posterName(0))).rejects.toMatchObject(
      notFound,
    );
    expect(fetched).toHaveBeenCalledTimes(1026);
  });

  test.each(["unavailable", "rate-limited", "invalid-response"] as const)(
    "answers an uncached image with 502 when TMDB is %s and retries next time",
    async (kind) => {
      const { proxy, fetched, log } = await artworkFixture();
      fetched.mockRejectedValueOnce(
        new IntegrationError("tmdb-images", kind, 503),
      );
      await expect(proxy.read("w342", POSTER)).rejects.toMatchObject(
        unavailable,
      );
      expect(log).toHaveBeenCalledExactlyOnceWith({
        event: "media_artwork_upstream_failed",
        key: `w342/${POSTER}`,
        kind,
        status: 503,
      });
      expect(proxy.metrics()).toContain(
        `media_artwork_upstream_total{outcome="${kind}"} 1\n`,
      );
      const retried = await proxy.read("w342", POSTER);
      expect(retried.bytes).toEqual(jpeg());
    },
  );

  test("does not turn an unexpected failure into an upstream outage", async () => {
    const { proxy, fetched } = await artworkFixture();
    fetched.mockRejectedValue(new TypeError("broken contract"));
    await expect(proxy.read("w342", POSTER)).rejects.toThrow(TypeError);
    expect(proxy.metrics()).toContain(
      'media_artwork_requests_total{outcome="error"} 1\n',
    );
  });

  test.each([
    ["truncated to nothing", (target: string) => writeFile(target, "")],
    ["overwritten", (target: string) => writeFile(target, "<html></html>")],
    ["deleted", (target: string) => rm(target)],
  ])("refetches a cached file that was %s", async (_case, damage) => {
    const { proxy, fetched, root } = await artworkFixture();
    await proxy.read("w342", POSTER);
    await damage(path.join(root, "w342", POSTER));
    const refetched = await proxy.read("w342", POSTER);
    expect(refetched.bytes).toEqual(jpeg());
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(proxy.metrics()).toContain("media_artwork_cache_corrupt_total 1\n");
    expect(await Bun.file(path.join(root, "w342", POSTER)).bytes()).toEqual(
      jpeg(),
    );
  });
});
