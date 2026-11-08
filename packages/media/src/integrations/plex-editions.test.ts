import { expect, test } from "vitest";
import { PlexClient } from "./plex.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";

const config = {
  baseUrl: "http://plex.fixture",
  token: "fixture",
  clientIdentifier: "media-fixture",
};

test.each(MovieEditionKeySchema.options)(
  "edition edit %s changes exactly one existing movie's registered label",
  async (edition) => {
    const calls: { url: URL; init: RequestInit }[] = [];
    const client = new PlexClient(config, (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("", { status: 200 }));
    });
    await client.editMovieEdition(
      { sectionId: "1", ratingKey: "123", edition },
      AbortSignal.timeout(1000),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe("/library/sections/1/all");
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      type: "1",
      id: "123",
      "editionTitle.value": MOVIE_EDITION_REGISTRY[edition].plexLabel,
      "editionTitle.locked": "1",
    });
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.body).toBeUndefined();
  },
);

test.each(["1,2", "", "0", "123&title.value=Other", "-1"])(
  "bulk or invalid item selector %s never reaches Plex",
  async (ratingKey) => {
    let called = false;
    const client = new PlexClient(config, () => {
      called = true;
      return Promise.resolve(new Response(""));
    });
    await expect(
      client.editMovieEdition(
        { sectionId: "1", ratingKey, edition: "directors_cut" },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    expect(called).toBe(false);
  },
);

test("a failed write is uncertain and is never blindly resubmitted by the adapter", async () => {
  let calls = 0;
  const client = new PlexClient(config, () => {
    calls++;
    return Promise.reject(new Error("Synthetic lost response"));
  });
  await expect(
    client.editMovieEdition(
      { sectionId: "1", ratingKey: "123", edition: "final_cut" },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ service: "plex", kind: "outcome-unknown" });
  expect(calls).toBe(1);
});

test("an already cancelled invocation cannot send an edition update", async () => {
  let calls = 0;
  const client = new PlexClient(config, () => {
    calls++;
    return Promise.resolve(new Response(""));
  });
  await expect(
    client.editMovieEdition(
      { sectionId: "1", ratingKey: "123", edition: "extended_cut" },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("edit readback retains existing item, Part and watch progress while the historical projection stays literal", async () => {
  const metadata = {
    ratingKey: "123",
    type: "movie",
    librarySectionID: 1,
    title: "Synthetic Film",
    editionTitle: "Director's Cut",
    viewCount: 3,
    lastViewedAt: 1_234_567,
    viewOffset: 456_000,
    Guid: [{ id: "tmdb://123" }],
    Media: [
      {
        Part: [
          { id: 456, file: "/data/movies/Existing Film.mkv", size: 12_345 },
        ],
      },
    ],
  };
  const client = new PlexClient(config, () =>
    Promise.resolve(
      Response.json({ MediaContainer: { size: 1, Metadata: [metadata] } }),
    ),
  );
  expect(
    await client.metadataForEditionEdit("123", AbortSignal.timeout(1000)),
  ).toEqual(metadata);
  const historical = await client.metadata("123");
  expect(historical).not.toHaveProperty("viewOffset");
  expect(historical).toMatchObject({
    ratingKey: "123",
    viewCount: 3,
    lastViewedAt: 1_234_567,
  });
});

test("a different item in edition readback fails before any mutation", async () => {
  const client = new PlexClient(config, () =>
    Promise.resolve(
      Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [{ ratingKey: "999", type: "movie", title: "Other Film" }],
        },
      }),
    ),
  );
  await expect(
    client.metadataForEditionEdit("123", AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ service: "plex", kind: "invalid-response" });
});
