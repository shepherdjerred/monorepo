import { afterEach, describe, expect, test, vi } from "vitest";
import {
  artworkFixture,
  jpeg,
  png,
  POSTER,
  removeArtworkFixtures,
} from "#infrastructure/artwork/artwork.test-support.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { TmdbImageClient } from "#integrations/tmdb-images.ts";
import { createMediaApp } from "#server/app.ts";
import { fixture, headers } from "#server/http.test-support.ts";

afterEach(removeArtworkFixtures);

const session = { Cookie: headers.Cookie };

/** The real application with a temporary cache directory and a stubbed CDN. */
async function application(respond: () => Response) {
  const transport = vi.fn<FetchTransport>(() => Promise.resolve(respond()));
  const { proxy } = await artworkFixture({
    upstream: new TmdbImageClient(transport),
  });
  const { dependencies } = fixture();
  return {
    app: createMediaApp({ ...dependencies, artwork: proxy }),
    transport,
  };
}

function image(bytes: Uint8Array<ArrayBuffer>, type: string) {
  return () => new Response(bytes, { headers: { "Content-Type": type } });
}

describe("artwork route", () => {
  test("requires a session", async () => {
    const { app, transport } = await application(image(jpeg(), "image/jpeg"));
    const response = await app.request(`/api/v1/artwork/w342/${POSTER}`);
    expect(response.status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  test.each([
    [POSTER, jpeg(48), "image/jpeg"],
    ["abcdefgh.png", png(64), "image/png"],
  ])(
    "serves %s from TMDB once with private immutable caching, then from disk",
    async (file, bytes, type) => {
      const { app, transport } = await application(image(bytes, type));
      for (const _attempt of ["miss", "hit"]) {
        const response = await app.request(`/api/v1/artwork/w342/${file}`, {
          headers: session,
        });
        expect(response.status).toBe(200);
        expect(Object.fromEntries(response.headers)).toMatchObject({
          "content-type": type,
          "content-length": String(bytes.byteLength),
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
        });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      }
      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]?.[0].href).toBe(
        `https://image.tmdb.org/t/p/w342/${file}`,
      );
    },
  );

  test.each([
    `original/${POSTER}`,
    `w92/${POSTER}`,
    "w342/poster.svg",
    "w342/short.jpg",
    `w342/${POSTER}.exe`,
    "w342/..%2F..%2Fetc%2Fpasswd",
    `w342/https:%2F%2Fexample.com%2F${POSTER}`,
  ])("rejects %s as invalid input without contacting TMDB", async (path) => {
    const { app, transport } = await application(image(jpeg(), "image/jpeg"));
    const response = await app.request(`/api/v1/artwork/${path}`, {
      headers: session,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_input" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(transport).not.toHaveBeenCalled();
  });

  test.each([
    [404, "artwork_not_found", () => new Response("gone", { status: 404 })],
    [502, "artwork_unavailable", () => new Response("busy", { status: 503 })],
    [502, "artwork_unavailable", () => new Response(null, { status: 429 })],
    [
      502,
      "artwork_unavailable",
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/x.jpg" },
        }),
    ],
    [502, "artwork_unavailable", image(png(), "image/jpeg")],
    [
      502,
      "artwork_unavailable",
      () =>
        new Response("<svg/>", {
          headers: { "Content-Type": "image/svg+xml" },
        }),
    ],
  ])(
    "answers %i %s without caching when TMDB does not supply the image",
    async (status, code, respond) => {
      const { app } = await application(respond);
      const response = await app.request(`/api/v1/artwork/w342/${POSTER}`, {
        headers: session,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    },
  );

  test("keeps serving a cached image while TMDB is unreachable", async () => {
    let reachable = true;
    const { app } = await application(() => {
      if (!reachable) throw new TypeError("fetch failed");
      return image(jpeg(), "image/jpeg")();
    });
    const url = `/api/v1/artwork/w780/${POSTER}`;
    const first = await app.request(url, { headers: session });
    expect(first.status).toBe(200);
    reachable = false;
    const cached = await app.request(url, { headers: session });
    expect(cached.status).toBe(200);
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(jpeg());
    const uncached = await app.request(`/api/v1/artwork/w185/${POSTER}`, {
      headers: session,
    });
    expect(uncached.status).toBe(502);
  });
});
