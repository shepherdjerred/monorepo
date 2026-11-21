import { expect, test } from "vitest";
import {
  rootArtwork,
  rootMedia,
} from "#infrastructure/library/views/artwork.ts";

type Row = {
  id: string;
  parentId: string | null;
  posterPath: string | null;
  backdropPath: string | null;
};
/** A row as every read loads it: with both ancestors, each possibly absent. */
type Loaded = Row & { parent: (Row & { parent: Row | null }) | null };

const unobserved = { posterPath: null, backdropPath: null };
function row(
  id: string,
  parentId: string | null,
  art: { posterPath: string | null; backdropPath: string | null } = unobserved,
): Row {
  return { id, parentId, ...art };
}
const series = row("series", null, {
  posterPath: "/series-poster.jpg",
  backdropPath: "/series-backdrop.jpg",
});
const seriesArt = {
  posterPath: "/series-poster.jpg",
  backdropPath: "/series-backdrop.jpg",
};
const unloaded = "Media ancestry was not loaded up to its root title";

test("a movie or series shows its own art", () => {
  const movie: Loaded = {
    ...row("movie", null, {
      posterPath: "/movie-poster.jpg",
      backdropPath: null,
    }),
    parent: null,
  };
  expect(rootArtwork(movie)).toEqual({
    posterPath: "/movie-poster.jpg",
    backdropPath: null,
  });
  expect(rootMedia(movie).id).toBe("movie");
});

test("a season and an episode inherit the series art through every stored shape", () => {
  const season: Loaded = {
    ...row("season", "series"),
    parent: { ...series, parent: null },
  };
  expect(rootArtwork(season)).toEqual(seriesArt);
  expect(rootMedia(season).id).toBe("series");
  const nested: Loaded = {
    ...row("episode", "season"),
    parent: { ...row("season", "series"), parent: series },
  };
  expect(rootArtwork(nested)).toEqual(seriesArt);
  expect(rootMedia(nested).id).toBe("series");
  const direct: Loaded = {
    ...row("episode", "series"),
    parent: { ...series, parent: null },
  };
  expect(rootArtwork(direct)).toEqual(seriesArt);
  expect(rootMedia(direct).id).toBe("series");
});

test("a root without observed art yields none rather than a descendant's value", () => {
  const episode: Loaded = {
    ...row("episode", "season", {
      posterPath: "/episode-still.jpg",
      backdropPath: "/episode-still.jpg",
    }),
    parent: {
      ...row("season", "series", {
        posterPath: "/season-poster.jpg",
        backdropPath: null,
      }),
      parent: row("series", null),
    },
  };
  expect(rootArtwork(episode)).toEqual(unobserved);
});

test("a row read without its ancestry is refused instead of passing as a root", () => {
  const withoutParent: Loaded = { ...row("episode", "season"), parent: null };
  expect(() => rootArtwork(withoutParent)).toThrow(unloaded);
  const withoutGrandparent: Loaded = {
    ...row("episode", "season"),
    parent: { ...row("season", "series"), parent: null },
  };
  expect(() => rootArtwork(withoutGrandparent)).toThrow(unloaded);
  const tooDeep: Loaded = {
    ...row("episode", "season"),
    parent: {
      ...row("season", "series"),
      parent: row("series", "collection"),
    },
  };
  expect(() => rootMedia(tooDeep)).toThrow(unloaded);
});
