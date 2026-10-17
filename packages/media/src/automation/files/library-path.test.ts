import { expect, test } from "vitest";
import { newLibraryPath, type NamingItem } from "./library-path.ts";
import { fileCoverage, probeAttributes } from "./inspection.ts";

const movie: NamingItem = {
  id: "local-only",
  kind: "movie",
  title: "The Film",
  year: 2026,
  tmdbId: 1234,
  parent: null,
  seasonNumber: null,
  episodeNumber: null,
};
const episode: NamingItem = {
  ...movie,
  id: "e1",
  kind: "episode",
  title: "The Bay",
  seasonNumber: 1,
  episodeNumber: 1,
  parent: {
    kind: "season",
    title: "Season 1",
    year: null,
    tmdbId: 900,
    parent: { kind: "series", title: "Coastlines", year: 2025, tmdbId: 5678 },
  },
};

test("movies use Plex catalog markers and release year without local identifiers", () => {
  expect(newLibraryPath([movie], "release.MKV")).toBe(
    "The Film (2026) {tmdb-1234}/The Film (2026) {tmdb-1234}.mkv",
  );
});
test("television uses series identity and canonical season/episode paths", () => {
  expect(newLibraryPath([episode], "release.mkv")).toBe(
    "Coastlines (2025) {tmdb-5678}/Season 01/Coastlines - S01E01 - The Bay.mkv",
  );
  expect(
    newLibraryPath(
      [episode, { ...episode, id: "e2", episodeNumber: 2 }],
      "release.mkv",
    ),
  ).toContain("S01E01-E02");
  expect(() =>
    newLibraryPath(
      [episode, { ...episode, id: "e3", episodeNumber: 3 }],
      "release.mkv",
    ),
  ).toThrow("file_coverage_discontinuous");
});
test("unknown episode mapping and missing catalog identity are protected", () => {
  expect(fileCoverage("show - 123.mkv", [episode])).toEqual([]);
  expect(fileCoverage("show.S01E01.mkv", [episode])).toEqual(["e1"]);
  expect(() =>
    newLibraryPath([{ ...movie, tmdbId: null }], "release.mkv"),
  ).toThrow("library_external_identity_missing");
});
test("measured resolution accounts for cropped video and does not invent unknown audio language", () => {
  expect(
    probeAttributes(
      {
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "hevc",
            width: 1920,
            height: 800,
          },
          { index: 1, codec_type: "audio" },
        ],
        format: { duration: "10", size: "1024", format_name: "matroska" },
      },
      "WEB-2160p",
    ),
  ).toEqual({ quality: "WEB-1080p", codec: "HEVC", audioLanguages: [] });
});
