import { expect, test } from "vitest";
import { subtitleSourceScoreV1 } from "./score.ts";
import {
  SubtitleMatchScoreV1Schema,
  subtitleScorePercent,
  type SubtitleScoreReferenceV1,
} from "#shared/subtitle-maintenance/score.ts";

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
