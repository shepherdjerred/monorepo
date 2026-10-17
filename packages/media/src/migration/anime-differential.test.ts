import { expect, test } from "vitest";
import cases from "#migration/fixtures/source-parse-anime.json";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import regexEvidence from "#migration/fixtures/regex-observations.json";
import { importResolvedProfiles } from "./profile-import.ts";
import { parseResolvedScene } from "#domain/resolved-parser.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import { observedRegexMatcher } from "./regex-evidence.ts";
import { matchRelease } from "#domain/release-parser.ts";

const profiles = importResolvedProfiles(snapshot).find(
  (source) => source.source === "sonarr",
)?.profiles;
if (profiles === undefined) throw new Error("Source profiles missing");
test("captured Sonarr anime grammar preserves quality, source title, group and revision", () => {
  for (const profile of profiles)
    for (const item of cases.cases) {
      const parsed = parseResolvedScene(profile, item.title);
      expect(parsed, item.title).toMatchObject({
        qualityId: item.quality.quality.id,
        releaseTitle: item.releaseTitle,
        releaseGroup: item.releaseGroup,
        revision: {
          version: item.quality.revision.version,
          real: item.quality.revision.real,
        },
        reasons: [],
      });
      const languages = item.languages.some((language) => language.id === 0)
        ? null
        : item.languages.map((language) =>
            language.name === "Japanese" ? "ja" : "en",
          );
      const result = evaluateResolvedRelease(
        profile,
        {
          id: item.title,
          qualityId: parsed.qualityId,
          releaseTitle: parsed.releaseTitle,
          releaseGroup: parsed.releaseGroup,
          revision: parsed.revision,
          identityConfirmed: true,
          filename: "",
          sizeBytes: 1_000_000_000,
          runtimeMinutes: 24,
          audioLanguages: languages,
          originalLanguage: null,
          specialEpisode: false,
        },
        observedRegexMatcher(regexEvidence),
      );
      const matchedFormatIds = new Set<number>(item.matchedFormatIds);
      const expected = profile.profile.formatItems.filter(
        (format) => format.score !== 0 && matchedFormatIds.has(format.format),
      );
      expect(result.unknownFormats, item.title).toEqual([]);
      expect(
        result.matchedFormats.toSorted((a, b) => a - b),
        item.title,
      ).toEqual(
        expected.map((format) => format.format).toSorted((a, b) => a - b),
      );
      expect(result.score, item.title).toBe(
        expected.reduce((sum, format) => sum + format.score, 0),
      );
    }
});
test("absolute coverage remains protected without exact owner numbering, and unsupported edition syntax remains protected", () => {
  const item = cases.cases[0];
  const profile = profiles[0];
  if (item === undefined || profile === undefined)
    throw new Error("Fixture missing");
  const media = {
    id: "episode",
    kind: "episode" as const,
    title: "Episode 1",
    year: null,
    seriesTitle: "Astral Journey",
    seasonNumber: 1,
    episodeNumber: 1,
  };
  const input = {
    id: "release",
    providerId: "fixture",
    title: item.title,
    sizeBytes: 1000,
    media,
  };
  const absent = matchRelease(input);
  expect(absent.reasons).toContain("absolute_numbering_unmapped");
  const mapped = matchRelease({
    ...input,
    knownEpisodes: [
      { mediaId: "episode", season: 1, episode: 1, absoluteNumber: 1 },
    ],
  });
  expect(mapped.attributes.mediaIds).toEqual(["episode"]);
  expect(mapped.attributes.audioLanguages).toEqual([]);
  for (const title of [
    "[ExampleGroup] Astral Journey - 01 [1080p BluRay WEB-DL x264 FLAC] [1234ABCD].mkv",
    "[ExampleGroup] Astral Journey - 01 [1080p WEB-DL H264 AAC Director Cut] [1234ABCD].mkv",
    "[ExampleGroup] Astral Journey - 01 [1080p] [1234ABCD].mkv",
  ])
    expect(parseResolvedScene(profile, title).reasons).toEqual([
      "source_parse_unsupported",
    ]);
});
