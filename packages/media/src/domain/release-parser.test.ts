import { describe, expect, it } from "vitest";
import { matchRelease, parseReleaseName } from "./release-parser.ts";
import type { ReleaseMatchInput } from "./release-parser.ts";

const base: ReleaseMatchInput = {
  id: "release",
  providerId: "tracker",
  title: "The.Film.2026.1080p.WEB-DL.HEVC.ENG-GROUP",
  sizeBytes: 1000,
  media: { id: "movie", kind: "movie", title: "The Film", year: 2026 },
};

describe("release identity proof", () => {
  it("matches punctuation-normalized movie title and year", () => {
    const result = matchRelease(base);
    expect(result.attributes).toMatchObject({
      identityConfidence: "exact",
      mediaIds: ["movie"],
      quality: "WEB-1080p",
      codec: "HEVC",
      audioLanguages: ["en"],
    });
  });
  it("does not confuse a same-name anime season pack with a movie", () => {
    const result = matchRelease({
      ...base,
      title: "The.Film.2026.S01.1080p.WEB-DL.HEVC",
    });
    expect(result.attributes.identityConfidence).toBe("mismatch");
    expect(result.reasons).toContain("movie_contains_episode_numbering");
  });
  it("requires a matching release year unless an external identity proves the work", () => {
    expect(
      matchRelease({ ...base, title: "The.Film.1080p.WEB-DL.HEVC" }).attributes
        .identityConfidence,
    ).toBe("ambiguous");
    expect(
      matchRelease({ ...base, title: "The.Film.1990.1080p.WEB-DL.HEVC" })
        .reasons,
    ).toContain("year_mismatch");
    expect(
      matchRelease({
        ...base,
        title: "Alternate.Name.1080p.WEB-DL.HEVC",
        media: { ...base.media, externalIds: { imdb: "tt123" } },
        externalIds: { imdb: "tt123" },
      }).attributes.identityConfidence,
    ).toBe("exact");
  });
  it("rejects conflicting provider identifiers even with a matching title", () => {
    expect(
      matchRelease({
        ...base,
        media: { ...base.media, externalIds: { imdb: "tt123" } },
        externalIds: { imdb: "tt999" },
      }).reasons,
    ).toContain("external_identity_conflict");
  });
  it("handles numeric titles without consuming the title as its year", () => {
    const input = {
      ...base,
      title: "1917.2019.2160p.BluRay.REMUX.HEVC",
      media: { ...base.media, title: "1917", year: 2019 },
    };
    expect(matchRelease(input).attributes.identityConfidence).toBe("exact");
    expect(parseReleaseName("1917.2160p.BluRay.REMUX.HEVC").title).toBe("1917");
  });
  it("does not infer original-language audio from catalog metadata or MULTi", () => {
    expect(
      matchRelease({ ...base, title: "The.Film.2026.1080p.WEB-DL.MULTi.HEVC" })
        .attributes.audioLanguages,
    ).toEqual([]);
  });
  it("protects same-name television remakes when release identity omits the year", () => {
    const input: ReleaseMatchInput = {
      ...base,
      title: "The.Office.S01E01.1080p.WEB-DL",
      media: {
        id: "us-e1",
        kind: "episode",
        title: "Pilot",
        year: 2005,
        seriesTitle: "The Office",
        seriesYear: 2005,
        seasonNumber: 1,
        episodeNumber: 1,
      },
      knownEpisodes: [{ mediaId: "us-e1", season: 1, episode: 1 }],
    };
    expect(matchRelease(input).attributes.identityConfidence).toBe("ambiguous");
    expect(
      matchRelease({ ...input, title: "The.Office.2001.S01E01.1080p.WEB-DL" })
        .attributes.identityConfidence,
    ).toBe("mismatch");
    expect(
      matchRelease({ ...input, title: "The.Office.2005.S01E01.1080p.WEB-DL" })
        .attributes.identityConfidence,
    ).toBe("exact");
  });
});

describe("episode coverage", () => {
  const series: ReleaseMatchInput = {
    ...base,
    title: "Coastlines.S01E02.1080p.WEB-DL.H264",
    media: {
      id: "e2",
      kind: "episode",
      title: "The Bay",
      seriesTitle: "Coastlines",
      year: null,
      seasonNumber: 1,
      episodeNumber: 2,
    },
    knownEpisodes: [
      { mediaId: "e1", season: 1, episode: 1, absoluteNumber: 13 },
      { mediaId: "e2", season: 1, episode: 2, absoluteNumber: 14 },
    ],
  };
  it("matches canonical episodes and rejects missing target coverage", () => {
    expect(matchRelease(series).attributes.mediaIds).toEqual(["e2"]);
    expect(
      matchRelease({ ...series, title: "Coastlines.S01E01.1080p.WEB-DL.H264" })
        .reasons,
    ).toContain("requested_episode_missing");
  });
  it("expands multi-episode ranges and complete seasons only through known metadata", () => {
    expect(
      parseReleaseName("Coastlines.S01E01E03.1080p.WEB-DL").episodes,
    ).toEqual([1, 3]);
    expect(
      parseReleaseName("Coastlines.S01E01E02E03.1080p.WEB-DL").episodes,
    ).toEqual([]);
    expect(
      matchRelease({
        ...series,
        title: "Coastlines.S01E01-E02.1080p.WEB-DL.H264",
      }).attributes.mediaIds,
    ).toEqual(["e1", "e2"]);
    expect(
      matchRelease({ ...series, title: "Coastlines.S01.1080p.WEB-DL.H264" })
        .attributes.mediaIds,
    ).toEqual(["e1", "e2"]);
    expect(
      matchRelease({
        ...series,
        title: "Coastlines.S01E01-E03.1080p.WEB-DL.H264",
      }).reasons,
    ).toContain("episode_numbering_unmapped");
  });
  it("requires explicit anime absolute numbering and rejects ambiguous mappings", () => {
    const title = "[Group] Coastlines - 13-14 [1080p WEB-DL H264]";
    expect(matchRelease({ ...series, title }).attributes.mediaIds).toEqual([
      "e1",
      "e2",
    ]);
    expect(
      matchRelease({ ...series, title, knownEpisodes: [] }).reasons,
    ).toContain("absolute_numbering_unmapped");
    expect(
      matchRelease({
        ...series,
        title,
        knownEpisodes: [
          ...(series.knownEpisodes ?? []),
          { mediaId: "other", season: 2, episode: 1, absoluteNumber: 14 },
        ],
      }).reasons,
    ).toContain("absolute_numbering_unmapped");
  });
  it("does not accept unknown episodes in manual overrides", () => {
    expect(() =>
      matchRelease({
        ...series,
        manualMapping: { releaseTitle: series.title, mediaIds: ["unknown"] },
      }),
    ).toThrow("unknown media");
    expect(
      matchRelease({
        ...series,
        title: "Unclear release",
        manualMapping: { releaseTitle: "Unclear release", mediaIds: ["e2"] },
      }).attributes.identityConfidence,
    ).toBe("exact");
  });
});
