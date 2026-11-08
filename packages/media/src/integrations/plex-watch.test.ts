import { describe, expect, it } from "vitest";
import { PlexClient } from "./plex.ts";
import type { FetchTransport } from "./http.ts";

const episode = {
  ratingKey: "42",
  type: "episode",
  title: "Synthetic episode",
  guid: "plex://episode/synthetic",
  parentRatingKey: "40",
  grandparentRatingKey: "39",
  index: 2,
  parentIndex: 1,
  year: 2024,
  viewCount: 3,
  lastViewedAt: 100,
  Guid: [{ id: "tmdb://123" }, { id: "tvdb://456" }],
  Media: [
    {
      Part: [{ id: 7, file: "/data/tv/Synthetic/S01E02.mkv", size: 128 }],
    },
  ],
};

function client(transport: FetchTransport) {
  return new PlexClient(
    {
      baseUrl: "http://plex.invalid",
      token: "synthetic-requester-token",
      clientIdentifier: "synthetic-client",
    },
    transport,
  );
}

function metadata(item: unknown) {
  return Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
}

describe("Plex requester watch observation", () => {
  it.each([1, Number.MAX_SAFE_INTEGER])(
    "retains emitted safe numeric librarySectionID %i through the HTTP parser",
    async (librarySectionID) => {
      const item = { ...episode, librarySectionID };
      const plex = client(async () => metadata(item));
      expect(await plex.observeWatch("42")).toEqual({ item, watched: true });
    },
  );

  it.each(["1", 0, Number.MAX_SAFE_INTEGER + 1])(
    "refuses malformed emitted librarySectionID %s",
    async (librarySectionID) => {
      const plex = client(async () =>
        metadata({ ...episode, librarySectionID }),
      );
      await expect(plex.observeWatch("42")).rejects.toMatchObject({
        service: "plex",
        kind: "invalid-response",
      });
    },
  );

  it("retains parsed identity, Parts and hierarchy from one authenticated metadata response", async () => {
    let calls = 0;
    const plex = client(async (url, init) => {
      calls++;
      expect(url.pathname).toBe("/library/metadata/42");
      expect([...url.searchParams]).toEqual([["includeGuids", "1"]]);
      const headers = new Headers(init.headers);
      expect(headers.get("X-Plex-Token")).toBe("synthetic-requester-token");
      expect(headers.get("X-Plex-Client-Identifier")).toBe("synthetic-client");
      expect(headers.get("Accept")).toBe("application/json");
      expect(init.redirect).toBe("manual");
      return metadata(episode);
    });

    const observation = await plex.observeWatch("42");
    expect(observation).toEqual({
      item: episode,
      watched: true,
    });
    expect(observation.item).not.toHaveProperty("librarySectionID");
    expect(calls).toBe(1);
  });

  it.each([
    { name: "absent", counters: {}, watched: false },
    { name: "zero", counters: { viewCount: 0 }, watched: false },
    { name: "positive", counters: { viewCount: 1 }, watched: true },
  ])(
    "uses current viewCount when $name, independently of lastViewedAt",
    async ({ counters, watched }) => {
      const { viewCount: _oldCount, ...rest } = episode;
      const item = { ...rest, ...counters };
      let calls = 0;
      const plex = client(async () => {
        calls++;
        return metadata(item);
      });

      expect(await plex.observeWatch("42")).toEqual({ item, watched });
      expect(calls).toBe(1);
    },
  );

  it("returns replaced content at the requested key for the authority consumer to compare", async () => {
    const replacement = {
      ...episode,
      viewCount: 0,
      grandparentRatingKey: "99",
      Guid: [{ id: "tmdb://999" }],
      Media: [{ Part: [{ id: 8, file: "/data/tv/Other.mkv" }] }],
    };
    let calls = 0;
    const plex = client(async () => {
      calls++;
      return metadata(replacement);
    });

    expect(await plex.observeWatch("42")).toEqual({
      item: replacement,
      watched: false,
    });
    expect(calls).toBe(1);
  });

  it.each([
    { name: "wrong key", size: 1, items: [{ ...episode, ratingKey: "43" }] },
    { name: "multiple items", size: 2, items: [episode, episode] },
    {
      name: "multiple items despite declared size",
      size: 1,
      items: [episode, episode],
    },
    { name: "missing item", size: 0, items: [] },
  ])(
    "refuses $name rather than returning a watch boolean",
    async ({ size, items }) => {
      let calls = 0;
      const plex = client(async () => {
        calls++;
        return Response.json({ MediaContainer: { size, Metadata: items } });
      });

      await expect(plex.observeWatch("42")).rejects.toMatchObject({
        service: "plex",
        kind: "invalid-response",
      });
      expect(calls).toBe(1);
    },
  );

  it.each([401, 403, 412])(
    "preserves authentication refusal for HTTP %i without retry or token substitution",
    async (status) => {
      let calls = 0;
      const plex = client(async (_url, init) => {
        calls++;
        expect(new Headers(init.headers).get("X-Plex-Token")).toBe(
          "synthetic-requester-token",
        );
        return new Response(null, { status });
      });

      await expect(plex.observeWatch("42")).rejects.toMatchObject({
        service: "plex",
        kind: "authentication",
        status,
      });
      expect(calls).toBe(1);
    },
  );

  it("propagates caller cancellation to the single metadata transport", async () => {
    const controller = new AbortController();
    const observed: {
      signal?: AbortSignal;
      abortedBefore?: boolean;
    } = {};
    const reason = new Error("Synthetic cancellation");
    let calls = 0;
    const plex = client(async (_url, init) => {
      calls++;
      const signal = init.signal;
      if (signal === undefined || signal === null)
        throw new Error("Expected combined request cancellation signal");
      observed.signal = signal;
      observed.abortedBefore = signal.aborted;
      controller.abort(reason);
      signal.throwIfAborted();
      throw new Error("Cancelled request unexpectedly continued");
    });

    await expect(
      plex.observeWatch("42", controller.signal),
    ).rejects.toMatchObject({
      service: "plex",
      kind: "unavailable",
    });
    expect(observed.abortedBefore).toBe(false);
    expect(observed.signal?.aborted).toBe(true);
    expect(observed.signal?.reason).toBe(reason);
    expect(calls).toBe(1);
  });

  it("keeps watched compatibility as a boolean from one current metadata request", async () => {
    let calls = 0;
    const plex = client(async () => {
      calls++;
      return metadata(episode);
    });

    expect(await plex.watched("42")).toBe(true);
    expect(calls).toBe(1);
  });
});
