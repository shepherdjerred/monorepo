import { describe, expect, it } from "vitest";
import type { PlaybackSession } from "#generated/prisma/client.ts";
import {
  playbackMediaByRatingKey,
  playbackSessionView,
  type PlaybackLinkTitle,
} from "./session-view.ts";

const series = {
  id: "series",
  kind: "series",
  title: "Severance",
  externalIds: {},
  parentId: null,
  posterPath: "/series-poster.jpg",
  backdropPath: "/series-backdrop.jpg",
} as const;
const season = {
  id: "season",
  kind: "season",
  title: "Season 1",
  externalIds: {},
  parentId: series.id,
  posterPath: null,
  backdropPath: null,
} as const;
const episode: PlaybackLinkTitle = {
  id: "episode",
  kind: "episode",
  title: "Good News About Hell",
  externalIds: {},
  parentId: season.id,
  posterPath: null,
  backdropPath: null,
  parent: { ...season, parent: series },
};
const movie: PlaybackLinkTitle = {
  id: "movie",
  kind: "movie",
  title: "Dune",
  externalIds: {},
  parentId: null,
  posterPath: "/movie-poster.jpg",
  backdropPath: null,
  parent: null,
};
const titles = [episode, movie];
const everything = () => true;

describe("playback title links", () => {
  it("links a movie play to the movie and its own artwork", () => {
    const links = playbackMediaByRatingKey(
      [{ ratingKey: "10", mediaId: movie.id }],
      titles,
      everything,
    );
    expect([...links]).toEqual([
      [
        "10",
        {
          id: "movie",
          rootMediaId: "movie",
          kind: "movie",
          title: "Dune",
          artwork: { posterPath: "/movie-poster.jpg", backdropPath: null },
        },
      ],
    ]);
  });

  it("links an episode play to the episode, its series and the series' artwork", () => {
    const links = playbackMediaByRatingKey(
      [{ ratingKey: "20", mediaId: episode.id }],
      titles,
      everything,
    );
    expect(links.get("20")).toEqual({
      id: "episode",
      rootMediaId: "series",
      kind: "episode",
      title: "Good News About Hell",
      artwork: {
        posterPath: "/series-poster.jpg",
        backdropPath: "/series-backdrop.jpg",
      },
    });
  });

  it("resolves a key that two sections claim for the same title", () => {
    const links = playbackMediaByRatingKey(
      [
        { ratingKey: "10", mediaId: movie.id },
        { ratingKey: "10", mediaId: movie.id },
      ],
      titles,
      everything,
    );
    expect(links.get("10")?.id).toBe("movie");
  });

  it("leaves out a key whose claims name different titles", () => {
    const links = playbackMediaByRatingKey(
      [
        { ratingKey: "10", mediaId: movie.id },
        { ratingKey: "10", mediaId: episode.id },
        { ratingKey: "20", mediaId: episode.id },
      ],
      titles,
      everything,
    );
    expect([...links.keys()]).toEqual(["20"]);
  });

  it("leaves out a title the reader cannot open", () => {
    const links = playbackMediaByRatingKey(
      [
        { ratingKey: "10", mediaId: movie.id },
        { ratingKey: "20", mediaId: episode.id },
      ],
      titles,
      (media) => media.kind !== "movie",
    );
    expect([...links.keys()]).toEqual(["20"]);
  });

  it("leaves out an episode whose series the reader cannot open", () => {
    const links = playbackMediaByRatingKey(
      [{ ratingKey: "20", mediaId: episode.id }],
      titles,
      (media) => media.kind !== "series",
    );
    expect(links.size).toBe(0);
  });

  it("refuses a claim that names a title that was not read", () => {
    expect(() =>
      playbackMediaByRatingKey(
        [{ ratingKey: "30", mediaId: "missing" }],
        titles,
        everything,
      ),
    ).toThrow("A Plex item claim names a title that does not exist");
  });
});

describe("playback session view", () => {
  const started = new Date("2026-11-14T12:00:00.000Z");
  const row: PlaybackSession = {
    id: "session",
    serverMachineId: "server",
    serverAccountId: "account",
    userId: "user",
    ratingKey: "10",
    title: "Dune",
    seriesTitle: null,
    mediaType: "movie",
    platform: "tvOS",
    playerId: "player",
    decision: "direct_play",
    startedAt: started,
    stoppedAt: null,
    lastSeenAt: started,
    durationMs: 1000,
    watchedMs: 500,
    maxProgressMs: 600,
    lastProgressMs: 600,
    meaningfulProgressAt: null,
    reportingCompleted: false,
    state: "playing",
    source: "plex",
    sourceSnapshotDigest: null,
  };
  const names = new Map([["user", "Member"]]);

  it("carries the title its rating key resolved to", () => {
    const links = playbackMediaByRatingKey(
      [{ ratingKey: "10", mediaId: movie.id }],
      titles,
      everything,
    );
    expect(playbackSessionView(row, names, links)).toMatchObject({
      id: "session",
      userName: "Member",
      progressMs: 600,
      media: { id: "movie", rootMediaId: "movie", kind: "movie" },
    });
  });

  it("carries no title for a rating key that did not resolve", () => {
    expect(playbackSessionView(row, names, new Map()).media).toBeNull();
  });
});
