import { expect, test } from "vitest";
import { catalogArtwork } from "./persist.ts";

test("catalog artwork keeps what the catalog sent", () => {
  expect(
    catalogArtwork({
      poster_path: "/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      overview: "A synopsis.",
    }),
  ).toEqual({
    posterPath: "/poster.jpg",
    backdropPath: "/backdrop.jpg",
    overview: "A synopsis.",
  });
});

test("a title with no images and an empty synopsis has no artwork, not blank artwork", () => {
  expect(
    catalogArtwork({ poster_path: null, backdrop_path: null, overview: "" }),
  ).toEqual({ posterPath: null, backdropPath: null, overview: null });
});
