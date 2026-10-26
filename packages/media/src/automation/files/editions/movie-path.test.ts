import { expect, test } from "vitest";
import { movieEditionLibraryPath } from "./movie-path.ts";
import {
  newLibraryPath,
  type NamingItem,
} from "#automation/files/library-path.ts";
import {
  movieEditionDefinition,
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";

const movie: NamingItem = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "movie",
  title: "Example Film",
  year: 2026,
  tmdbId: 123,
  seasonNumber: null,
  episodeNumber: null,
  parent: null,
};

test("unmarked naming preserves the historical path exactly without asserting theatrical", () => {
  const named = movieEditionLibraryPath(
    movie,
    "synthetic.MKV",
    movieEditionDefinition(movie.id, "default"),
  );
  expect(named).toBe(newLibraryPath([movie], "synthetic.MKV"));
  expect(named).toBe(
    "Example Film (2026) {tmdb-123}/Example Film (2026) {tmdb-123}.mkv",
  );
});

test("registered editions occupy distinct paths and carry the Plex label in folder and filename", () => {
  const paths = new Set<string>();
  for (const edition of MovieEditionKeySchema.options) {
    const named = movieEditionLibraryPath(
      movie,
      "synthetic.MKV",
      movieEditionDefinition(movie.id, edition),
    );
    paths.add(named);
    const parts = named.split("/");
    expect(parts).toHaveLength(2);
    if (edition !== "default") {
      const suffix = `{edition-${MOVIE_EDITION_REGISTRY[edition].plexLabel}}`;
      expect(parts[0]?.endsWith(suffix)).toBe(true);
      expect(parts[1]?.endsWith(`${suffix}.mkv`)).toBe(true);
    }
  }
  expect(paths.size).toBe(7);
});

test("another movie definition and TV cut naming fail before producing a path", () => {
  expect(() =>
    movieEditionLibraryPath(
      movie,
      "synthetic.mkv",
      movieEditionDefinition(
        "10000000-0000-4000-8000-000000000002",
        "directors_cut",
      ),
    ),
  ).toThrow("edition_definition_conflict");
  expect(() =>
    movieEditionLibraryPath(
      { ...movie, kind: "episode" },
      "synthetic.mkv",
      movieEditionDefinition(movie.id, "directors_cut"),
    ),
  ).toThrow("edition_definition_conflict");
});
