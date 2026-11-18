import { describe, expect, test } from "vitest";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import {
  listSeriesCatalog,
  nextEpisodeInSeries,
  normalizeSeriesKey,
  parseEpisodeMarker,
  pickEpisodicCandidate,
} from "@shepherdjerred/streambot/metadata/series-progression.ts";

function tvEntry(options: {
  readonly series?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly title: string;
  readonly path: string;
}): LibraryEntry {
  return {
    title: options.title,
    path: options.path,
    relativePath: options.path.replace(/^\/media\/tv\//u, ""),
    library: "tv",
    ...(options.series === undefined ? {} : { series: options.series }),
    ...(options.season === undefined ? {} : { season: options.season }),
    ...(options.episode === undefined ? {} : { episode: options.episode }),
  };
}

function movieEntry(title: string, path: string): LibraryEntry {
  return {
    title,
    path,
    relativePath: path.replace(/^\/media\/movies\//u, ""),
    library: "movies",
  };
}

describe("series-progression helpers", () => {
  test("normalizeSeriesKey canonicalizes punctuation, casing, and episode suffixes", () => {
    expect(normalizeSeriesKey("The Bear")).toBe("thebear");
    expect(normalizeSeriesKey("the-bear")).toBe("thebear");
    expect(normalizeSeriesKey("The Bear S01E08")).toBe("thebear");
    expect(normalizeSeriesKey("The Bear - S01E08 - Review")).toBe("thebear");
    expect(normalizeSeriesKey("The_Bear_S02E01_1080p.mkv")).toBe("thebear");
    expect(normalizeSeriesKey("The.Bear.S01E01.WEB-DL")).toBe("thebear");
    expect(normalizeSeriesKey("24 - S01E01")).toBe("24");
    expect(normalizeSeriesKey("9-1-1 S03E02")).toBe("911");
    expect(normalizeSeriesKey("S01E08")).toBe("");
  });

  test("parseEpisodeMarker parses both raw titles and LibraryEntry forms", () => {
    expect(parseEpisodeMarker("The Bear - S01E08 - Review")).toEqual({
      seriesKey: "thebear",
      seriesLabel: "The Bear",
      season: 1,
      episode: 8,
    });
    expect(parseEpisodeMarker("Fawlty Towers 1x06")).toEqual({
      seriesKey: "fawltytowers",
      seriesLabel: "Fawlty Towers",
      season: 1,
      episode: 6,
    });
    expect(parseEpisodeMarker("Inception (2010)")).toBeNull();

    // Year-stripped display title produced by scanRoot when a year precedes SxxExx.
    expect(
      parseEpisodeMarker(
        tvEntry({
          series: "The Show (2020)",
          season: 2,
          episode: 3,
          title: "The Show (2020)",
          path: "/media/tv/The Show (2020)/Season 02/The_Show_(2020)_S02E03_1080p.mkv",
        }),
      ),
    ).toEqual({
      seriesKey: "theshow2020",
      seriesLabel: "The Show (2020)",
      season: 2,
      episode: 3,
    });
  });

  test("listSeriesCatalog groups shows and sorts episodes deterministically by (season, episode, path)", () => {
    const entries: readonly LibraryEntry[] = [
      movieEntry("Heat (1995)", "/media/movies/Heat (1995).mkv"),
      tvEntry({
        series: "The Bear",
        season: 2,
        episode: 1,
        title: "The Bear - S02E01",
        path: "/media/tv/The Bear/Season 02/The Bear - S02E01.mkv",
      }),
      tvEntry({
        series: "The Bear",
        season: 1,
        episode: 8,
        title: "The Bear - S01E08",
        path: "/media/tv/The Bear/Season 01/The Bear - S01E08-b.mkv",
      }),
      tvEntry({
        series: "The Bear",
        season: 1,
        episode: 8,
        title: "The Bear - S01E08",
        path: "/media/tv/The Bear/Season 01/The Bear - S01E08-a.mkv",
      }),
      tvEntry({
        series: "The Bear",
        season: 1,
        episode: 1,
        title: "The Bear - S01E01",
        path: "/media/tv/The Bear/Season 01/The Bear - S01E01.mkv",
      }),
    ];

    const catalog = listSeriesCatalog(entries);
    expect([...catalog.keys()]).toEqual(["thebear"]);
    const bear = catalog.get("thebear");
    expect(bear?.series).toBe("The Bear");
    expect(bear?.seasons).toBe(2);
    expect(bear?.episodes.map((ep) => ep.path)).toEqual([
      "/media/tv/The Bear/Season 01/The Bear - S01E01.mkv",
      "/media/tv/The Bear/Season 01/The Bear - S01E08-a.mkv",
      "/media/tv/The Bear/Season 01/The Bear - S01E08-b.mkv",
      "/media/tv/The Bear/Season 02/The Bear - S02E01.mkv",
    ]);
  });
});

describe("series progression and episodic candidate rotation", () => {
  test("nextEpisodeInSeries rolls across season boundaries, skips missing episodes, and returns null at the finale", () => {
    const entries: readonly LibraryEntry[] = [
      tvEntry({
        series: "The Bear (2022)",
        season: 0,
        episode: 1,
        title: "The Bear - S00E01",
        path: "/media/tv/The Bear (2022)/Specials/The Bear - S00E01.mkv",
      }),
      tvEntry({
        series: "The Bear (2022)",
        season: 1,
        episode: 2,
        title: "The Bear - S01E02",
        path: "/media/tv/The Bear (2022)/Season 01/The Bear - S01E02.mkv",
      }),
      tvEntry({
        series: "The Bear (2022)",
        season: 1,
        episode: 4,
        title: "The Bear - S01E04",
        path: "/media/tv/The Bear (2022)/Season 01/The Bear - S01E04.mkv",
      }),
      tvEntry({
        series: "The Bear (2022)",
        season: 1,
        episode: 8,
        title: "The Bear - S01E08",
        path: "/media/tv/The Bear (2022)/Season 01/The Bear - S01E08.mkv",
      }),
      tvEntry({
        series: "The Bear (2022)",
        season: 2,
        episode: 1,
        title: "The Bear - S02E01",
        path: "/media/tv/The Bear (2022)/Season 02/The Bear - S02E01.mkv",
      }),
      tvEntry({
        series: "Severance",
        season: 1,
        episode: 9,
        title: "Severance - S01E09",
        path: "/media/tv/Severance/Season 01/Severance - S01E09.mkv",
      }),
      tvEntry({
        series: "Doctor Who (1963)",
        season: 1,
        episode: 1,
        title: "Doctor Who (1963) - S01E01",
        path: "/media/tv/Doctor Who (1963)/Season 01/S01E01.mkv",
      }),
      tvEntry({
        series: "Doctor Who (2005)",
        season: 1,
        episode: 1,
        title: "Doctor Who (2005) - S01E01",
        path: "/media/tv/Doctor Who (2005)/Season 01/S01E01.mkv",
      }),
      tvEntry({
        series: "Doctor Who (2005)",
        season: 1,
        episode: 2,
        title: "Doctor Who (2005) - S01E02",
        path: "/media/tv/Doctor Who (2005)/Season 01/S01E02.mkv",
      }),
    ];

    // Missing E03 on disk: S01E02 advances cleanly to S01E04.
    expect(
      nextEpisodeInSeries(entries, { title: "The Bear - S01E02" })?.title,
    ).toBe("The Bear - S01E04");

    // Season boundary rollover: S01E08 -> S02E01.
    expect(
      nextEpisodeInSeries(entries, { title: "The Bear - S01E08" })?.title,
    ).toBe("The Bear - S02E01");

    // Series finale returns null (never wraps to S00E01 or crosses into Severance).
    expect(
      nextEpisodeInSeries(entries, {
        title: "The Bear - S02E01",
        path: "/media/tv/The Bear (2022)/Season 02/The Bear - S02E01.mkv",
      }),
    ).toBeNull();

    // Multi-show remake disambiguation keeps 1963 and 2005 separate.
    expect(
      nextEpisodeInSeries(entries, { title: "Doctor Who (1963) - S01E01" }),
    ).toBeNull();
    expect(
      nextEpisodeInSeries(entries, { title: "Doctor Who (2005) - S01E01" })
        ?.title,
    ).toBe("Doctor Who (2005) - S01E02");
    expect(
      nextEpisodeInSeries(entries, { title: "Doctor Who - S01E01" }),
    ).toBeNull();
  });

  test("pickEpisodicCandidate rotates shows, honors preferredSeriesKeys and allowedPaths, and excludes recent paths", () => {
    const office1 = tvEntry({
      series: "The Office",
      season: 1,
      episode: 1,
      title: "The Office - S01E01",
      path: "/media/tv/The Office/S01E01.mkv",
    });
    const office2 = tvEntry({
      series: "The Office",
      season: 1,
      episode: 2,
      title: "The Office - S01E02",
      path: "/media/tv/The Office/S01E02.mkv",
    });
    const seinfeld1 = tvEntry({
      series: "Seinfeld",
      season: 1,
      episode: 1,
      title: "Seinfeld - S01E01",
      path: "/media/tv/Seinfeld/S01E01.mkv",
    });
    const movie = movieEntry("Dune (2021)", "/media/movies/Dune.mkv");
    const entries = [movie, office1, office2, seinfeld1];

    // Prefers requested series and skips excluded paths.
    expect(
      pickEpisodicCandidate(entries, {
        preferredSeriesKeys: new Set(["theoffice"]),
        excludePaths: new Set([office1.path]),
        rng: () => 0,
      }),
    ).toEqual(office2);

    // Falls back to remaining eligible series when all preferred episodes were recently played.
    expect(
      pickEpisodicCandidate(entries, {
        preferredSeriesKeys: new Set(["theoffice"]),
        excludePaths: new Set([office1.path, office2.path]),
        rng: () => 0,
      }),
    ).toEqual(seinfeld1);

    // Hard allowedPaths filter returns null when no episodic path is eligible.
    expect(
      pickEpisodicCandidate(entries, {
        allowedPaths: new Set([movie.path]),
        rng: () => 0,
      }),
    ).toBeNull();

    // Deterministic show rotation across Seinfeld (index 0) and The Office (index 1).
    expect(pickEpisodicCandidate(entries, { rng: () => 0.1 })?.series).toBe(
      "Seinfeld",
    );
    expect(pickEpisodicCandidate(entries, { rng: () => 0.9 })?.path).toBe(
      office2.path,
    );
  });
});
