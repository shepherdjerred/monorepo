import { expect, test } from "vitest";
import { createMediaPathMapping } from "./media-paths.ts";

const canonicalRoots = {
  movies: {
    library: "/data/movies",
    control: "/data/movies/.media-control",
    downloads: "/downloads",
  },
  tv: {
    library: "/data/tv",
    control: "/data/tv/.media-control",
    downloads: "/downloads",
  },
};
const workerRoots = {
  movies: {
    library: "/fixture/movies",
    control: "/fixture/movies/.media-control",
    downloads: "/fixture/downloads",
  },
  tv: {
    library: "/fixture/tv",
    control: "/fixture/tv/.media-control",
    downloads: "/fixture/downloads",
  },
};
test("maps the exact shared downloads and separate library/control namespaces in both directions", () => {
  const mapping = createMediaPathMapping({ canonicalRoots, workerRoots });
  expect(mapping.canonical("movies", "library", "Film/video.mkv")).toBe(
    "/data/movies/Film/video.mkv",
  );
  expect(mapping.local("/data/movies/.media-control/rollback/a")).toBe(
    "/fixture/movies/.media-control/rollback/a",
  );
  expect(mapping.canonical("tv", "downloads", "attempt/a")).toBe(
    "/downloads/attempt/a",
  );
  expect(mapping.local("/downloads/attempt/a")).toBe(
    "/fixture/downloads/attempt/a",
  );
  expect(() =>
    mapping.canonical("movies", "library", ".media-control/rollback/a"),
  ).toThrow("mapping");
  expect(() => mapping.canonical("movies", "control", "../escape")).toThrow(
    "mapping",
  );
  expect(() => mapping.local("/data/other/a")).toThrow("mapping");
});
test("rejects cross-kind and shared-download ambiguity instead of choosing the first matching root", () => {
  expect(() =>
    createMediaPathMapping({
      canonicalRoots,
      workerRoots: { ...workerRoots, tv: { ...workerRoots.movies } },
    }),
  ).toThrow("mapping");
  expect(() =>
    createMediaPathMapping({
      canonicalRoots,
      workerRoots: {
        ...workerRoots,
        tv: { ...workerRoots.tv, downloads: "/different" },
      },
    }),
  ).toThrow("mapping");
  expect(() =>
    createMediaPathMapping({
      canonicalRoots,
      workerRoots: {
        ...workerRoots,
        movies: { ...workerRoots.movies, control: "/fixture/separate" },
      },
    }),
  ).toThrow("mapping");
});
