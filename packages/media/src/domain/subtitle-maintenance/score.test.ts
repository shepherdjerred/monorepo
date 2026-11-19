import { expect, test } from "vitest";
import { subtitleSourceScoreV1 } from "./score.ts";
import {
  SubtitleMatchScoreV1Schema,
  subtitleScorePercent,
  type SubtitleScoreReferenceV1,
} from "#shared/subtitle-maintenance/score.ts";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
} from "#shared/movie-editions/registry.ts";

const movie: SubtitleScoreReferenceV1 = {
  schemaVersion: 1,
  kind: "movie",
  title: "Spirited Away",
  year: 2001,
  season: null,
  episode: null,
  sourceFilename: "Spirited.Away.2001.1080p.BluRay.x264-GROUP.mkv",
  quality: "bluray-1080p",
  videoCodec: "h264",
  audioCodec: null,
  imdbId: "tt0245429",
  tmdbId: 129,
  edition: "default",
};
test("actual foreign provider identity earns canonical title/year without English filename", () => {
  const score = subtitleSourceScoreV1(movie, {
    filename: "Sen.to.Chihiro.no.Kamikakushi.2001.1080p.BluRay.x264-GROUP.srt",
    hearingImpaired: false,
    catalogEvidenceV1: {
      kind: "movie",
      imdbId: "tt245429",
      tmdbId: 129,
      season: null,
      episode: null,
    },
  });
  expect(score.catalogStatus).toBe("confirmed");
  expect(score.matches).toEqual(
    expect.arrayContaining(["title", "year", "source", "release_group"]),
  );
  expect(subtitleScorePercent(score)).toBeGreaterThanOrEqual(80);
  expect(subtitleScorePercent(score)).toBeLessThan(100);
  expect(score.matches).not.toContain("audio_codec");
  expect(score.matches).not.toContain("edition");
});
test("conflicting canonical ID remains a conflict even with identical release naming", () => {
  const score = subtitleSourceScoreV1(movie, {
    filename: movie.sourceFilename,
    hearingImpaired: false,
    catalogEvidenceV1: {
      kind: "movie",
      imdbId: "tt0000001",
      tmdbId: null,
      season: null,
      episode: null,
    },
  });
  expect(score.catalogStatus).toBe("conflict");
});
test("unknown metadata earns no guessed edition, audio or hash points", () => {
  const score = subtitleSourceScoreV1(
    { ...movie, year: null, quality: null, videoCodec: null },
    { filename: "unknown.srt", hearingImpaired: null },
  );
  expect(score.score).toBe(0);
  expect(score.matches).toEqual([]);
  expect(() =>
    SubtitleMatchScoreV1Schema.parse({ ...score, score: 180 }),
  ).toThrow();
});
test("episode score binds genuine parent series and episode coordinates", () => {
  const score = subtitleSourceScoreV1(
    {
      ...movie,
      kind: "episode",
      title: "Example",
      year: 2025,
      season: 2,
      episode: 3,
      sourceFilename: "Example.S02E03.1080p.WEB-DL.x265-TEAM.mkv",
      quality: "webdl-1080p",
      videoCodec: "hevc",
    },
    {
      filename: "Foreign.Name.S02E03.1080p.WEB-DL.x265-TEAM.srt",
      hearingImpaired: false,
      catalogEvidenceV1: {
        kind: "series",
        imdbId: movie.imdbId,
        tmdbId: null,
        season: 2,
        episode: 3,
      },
    },
  );
  expect(score.matches).toEqual(
    expect.arrayContaining(["series", "year", "season", "episode"]),
  );
  expect(score.kind).toBe("episode");
});

test.each(["WEBDL-1080p", "WEB-DL-1080p", "WEB-1080p"])(
  "measured %s and parsed WEB-DL retain the same source evidence",
  (quality) => {
    const filename = "Spirited.Away.2001.1080p.WEB-DL.H264-GROUP.mkv";
    const score = subtitleSourceScoreV1(
      { ...movie, quality, sourceFilename: filename },
      { filename: filename.replace(/\.mkv$/u, ".srt"), hearingImpaired: false },
    );
    expect(score.matches).toContain("source");
    expect(subtitleScorePercent(score)).toBeGreaterThanOrEqual(80);
    expect(score.matches).not.toContain("edition");
    expect(score.matches).not.toContain("audio_codec");
  },
);

test.each(["WEBRip-1080p", "unknown"])(
  "distinct or unknown measured %s does not earn WEB-DL source points",
  (quality) => {
    const score = subtitleSourceScoreV1(
      { ...movie, quality },
      {
        filename: "Spirited.Away.2001.1080p.WEB-DL.H264-GROUP.srt",
        hearingImpaired: false,
      },
    );
    expect(score.matches).not.toContain("source");
  },
);

test.each(MovieEditionKeySchema.options)(
  "the actual initial %s library caption filename earns observed points",
  (edition) => {
    const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
    const filename = `Synthetic.Film${edition === "default" ? "" : ` {edition-${label}}`}.1080p.WEB-DL.H264-GROUP`;
    const score = subtitleSourceScoreV1(
      {
        ...movie,
        title: "Synthetic Film",
        year: null,
        edition,
        sourceFilename: `${filename}.mkv`,
        quality: "WEBDL-1080p",
        tmdbId: 1,
      },
      {
        filename: `${filename}.srt`,
        hearingImpaired: false,
        catalogEvidenceV1: {
          kind: "movie",
          tmdbId: 1,
          imdbId: null,
          season: null,
          episode: null,
        },
      },
    );
    expect(score.catalogStatus).toBe("confirmed");
    expect(score.matches).toEqual(
      expect.arrayContaining([
        "title",
        "year",
        "source",
        "resolution",
        "video_codec",
        "release_group",
      ]),
    );
    expect(subtitleScorePercent(score)).toBeGreaterThanOrEqual(80);
    expect(subtitleScorePercent(score)).toBeLessThan(86);
  },
);

test.each([false, true])(
  "real release-group evidence before ENG qualifies the matching forced/SDH=%s caption",
  (hearingImpaired) => {
    const filename =
      "Workflow.Fixture.2020.Extended.Cut.1080p.WEB-DL.H264-GROUP.ENG";
    const score = subtitleSourceScoreV1(
      {
        ...movie,
        title: "Workflow Fixture",
        year: 2020,
        sourceFilename: `${filename}.mkv`,
        quality: "WEB-1080p",
      },
      {
        filename: `${filename}${hearingImpaired ? ".forced.sdh" : ""}.srt`,
        hearingImpaired,
        catalogEvidenceV1: {
          kind: "movie",
          tmdbId: movie.tmdbId,
          imdbId: movie.imdbId,
          season: null,
          episode: null,
        },
      },
    );
    expect(score.matches).toContain("release_group");
    expect(subtitleScorePercent(score)).toBeGreaterThanOrEqual(80);
    expect(subtitleScorePercent(score)).toBeLessThan(86);
  },
);
