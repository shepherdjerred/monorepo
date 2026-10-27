import { expect, test } from "vitest";
import type { PlexEditionItem } from "#integrations/plex.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import {
  capturePlexEditionSnapshotV1,
  planPlexEditionChangeV1,
  assertPlexEditionReadbackV1,
} from "./plex-edition.ts";

const mediaId = crypto.randomUUID();
const input = {
  serverMachineId: "fixture-server",
  sectionId: "1",
  canonicalPath: "/data/movies/Existing Film.mkv",
  sizeBytes: "12345",
  media: {
    id: mediaId,
    kind: "movie",
    tmdbId: 123,
    externalIds: {},
    seasonNumber: null,
    episodeNumber: null,
  },
};
function item(editionTitle = "Incorrect label"): PlexEditionItem {
  return {
    ratingKey: "123",
    type: "movie",
    librarySectionID: 1,
    title: "Synthetic Film",
    year: 2020,
    editionTitle,
    Guid: [{ id: "tmdb://123" }],
    viewCount: 3,
    lastViewedAt: 1_234_567,
    viewOffset: 456_000,
    Media: [{ Part: [{ id: 456, file: input.canonicalPath, size: 12_345 }] }],
  };
}

test.each(MovieEditionKeySchema.options)(
  "%s edit planning and readback keep the existing item, Part and watch facts",
  (edition) => {
    const before = capturePlexEditionSnapshotV1(item(), input);
    const scope = { rootMediaId: mediaId, mediaId, edition };
    const change = planPlexEditionChangeV1(before, scope, crypto.randomUUID());
    expect(change).toMatchObject({
      scope,
      beforeEditionTitle: "Incorrect label",
      targetEditionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel,
    });
    const after = capturePlexEditionSnapshotV1(
      item(MOVIE_EDITION_REGISTRY[edition].plexLabel),
      input,
    );
    expect(after.identityHash).toBe(before.identityHash);
    expect(after.watch).toEqual(before.watch);
    expect(() =>
      assertPlexEditionReadbackV1(before, after, edition),
    ).not.toThrow();
    expect(
      planPlexEditionChangeV1(after, scope, crypto.randomUUID()),
    ).toBeNull();
  },
);

test("a replacement Plex Part at the same path cannot supply edit readback", () => {
  const before = capturePlexEditionSnapshotV1(item(), input);
  const replacement = {
    ...item("Final Cut"),
    Media: [{ Part: [{ id: 999, file: input.canonicalPath, size: 12_345 }] }],
  };
  const after = capturePlexEditionSnapshotV1(replacement, input);
  expect(() =>
    assertPlexEditionReadbackV1(before, after, "final_cut"),
  ).toThrow();
});

test("conflicting canonical identity prevents an edit plan", () => {
  expect(() =>
    capturePlexEditionSnapshotV1(
      { ...item(), Guid: [{ id: "tmdb://999" }] },
      input,
    ),
  ).toThrow();
  const before = capturePlexEditionSnapshotV1(item(), input);
  const otherId = crypto.randomUUID();
  expect(() =>
    planPlexEditionChangeV1(
      before,
      { rootMediaId: otherId, mediaId: otherId, edition: "directors_cut" },
      crypto.randomUUID(),
    ),
  ).toThrow();
});

test.each(["count", "time", "progress"])(
  "lost watch %s protects the edit instead of rewriting watch state",
  (field) => {
    const before = capturePlexEditionSnapshotV1(item(), input);
    const changed = {
      ...item("Extended Cut"),
      ...(field === "count" ? { viewCount: 2 } : {}),
      ...(field === "time" ? { lastViewedAt: 123 } : {}),
      ...(field === "progress" ? { viewOffset: 0 } : {}),
    };
    const after = capturePlexEditionSnapshotV1(changed, input);
    expect(() =>
      assertPlexEditionReadbackV1(before, after, "extended_cut"),
    ).toThrow();
  },
);

test("natural playback completion may advance watch count and reset progress", () => {
  const before = capturePlexEditionSnapshotV1(item(), input);
  const after = capturePlexEditionSnapshotV1(
    {
      ...item("Director's Cut"),
      viewCount: 4,
      lastViewedAt: 1_234_568,
      viewOffset: 0,
    },
    input,
  );
  expect(() =>
    assertPlexEditionReadbackV1(before, after, "directors_cut"),
  ).not.toThrow();
});
