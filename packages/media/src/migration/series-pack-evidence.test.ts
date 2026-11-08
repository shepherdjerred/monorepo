import { expect, test } from "vitest";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import { importResolvedProfiles } from "./profile-import.ts";
import { prepareResolvedEvidence, regexRequests } from "./runtime-evidence.ts";
import { prepareSeriesPackResolvedEvidenceV1 } from "./series-pack-evidence.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import {
  ResolvedEvidenceProtocolSchema,
  ResolvedEvidenceSchema,
  SeriesPackResolvedEvidenceV1Schema,
  projectResolvedCatalog,
} from "#domain/resolved-evidence.ts";
import { parseResolvedSeriesPackMemberV1 } from "#domain/acquisition-identity/series-pack-scene.ts";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";

const profile = importResolvedProfiles(snapshot).find(
  (entry) => entry.source === "sonarr",
)?.profiles[0];
if (profile === undefined)
  throw new Error("Actual captured Sonarr policy missing");
const title = "Synthetic.Anime.2020.S01-S02.1080p.WEB-DL.H264.English-MEDIA";
const parsed = parseSeriesSeasonSetV1(title);
if (parsed.status !== "resolved")
  throw new Error("Actual range fixture invalid");
const range = parsed.range;
const input = {
  id: "actual-new-assessment",
  title,
  identityConfirmed: true,
  sizeBytes: 200_000_000,
  runtimeMinutes: 4,
  originalLanguage: "en",
  audioLanguages: ["en"],
  specialEpisode: false,
};

test("the new range quality grammar preserves original title and original v2 parser output", () => {
  const before = prepareResolvedEvidence(profile, input);
  expect(before).toMatchObject({
    parserVersion: "scene-anime-v2",
    protectedReasons: ["source_parse_unsupported"],
    release: { qualityId: 0 },
  });
  const evidence = prepareSeriesPackResolvedEvidenceV1(profile, input, range);
  expect(evidence).toMatchObject({
    parserVersion: "scene-series-pack-v1",
    source: "sonarr",
    protectedReasons: [],
    release: { qualityId: 3, releaseTitle: title, releaseGroup: "MEDIA" },
  });
  expect(ResolvedEvidenceSchema.safeParse(evidence).success).toBe(false);
  expect(ResolvedEvidenceProtocolSchema.parse(evidence)).toEqual(evidence);
  expect(
    SeriesPackResolvedEvidenceV1Schema.safeParse({
      ...evidence,
      source: "radarr",
    }).success,
  ).toBe(false);
  expect(
    projectResolvedCatalog(evidence, {
      runtimeMinutes: 24,
      originalLanguage: "en",
    }),
  ).toMatchObject({
    parserVersion: "scene-series-pack-v1",
    release: { runtimeMinutes: 24, releaseTitle: title },
  });
  expect(prepareResolvedEvidence(profile, input)).toEqual(before);
});

test.each(["S01-S02.S03", "S01-S02.S01E01", "S00-S02", "S02-S01"])(
  "conflicting %s never becomes resolved quality evidence",
  (token) => {
    const evidence = prepareSeriesPackResolvedEvidenceV1(
      profile,
      { ...input, title: title.replace("S01-S02", token) },
      range,
    );
    expect(evidence.protectedReasons).toEqual(["source_parse_unsupported"]);
    expect(evidence.release.qualityId).toBe(0);
  },
);

test("actual member numbering and quality are parsed separately while regex inputs retain the raw pack title and member filename", () => {
  const seriesId = crypto.randomUUID();
  const coordinates: CoordinateSnapshot = {
    schemaVersion: 1,
    seriesId,
    seriesVersion: 1,
    catalogComplete: true,
    fullSeriesNumberingDigest: "a".repeat(64),
    digest: "b".repeat(64),
    episodes: [1, 2].flatMap((seasonNumber) =>
      [1, 2].map((episodeNumber) => ({
        mediaId: crypto.randomUUID(),
        mediaVersion: 1,
        seriesId,
        seasonNumber,
        episodeNumber,
        tmdbEpisodeId: null,
        absoluteNumber: null,
        numberingProvenance: { kind: "canonical" as const },
      })),
    ),
  };
  const filename = title.replace("S01-S02", "S02E01-E02") + ".mkv";
  const member = parseResolvedSeriesPackMemberV1(profile, {
    filename,
    releaseTitle: title,
    coordinates,
    coverage: coordinates.episodes
      .filter((episode) => episode.seasonNumber === 2)
      .map((episode) => episode.mediaId),
  });
  expect(member).toMatchObject({
    qualityId: 3,
    releaseTitle: title,
    releaseGroup: "MEDIA",
    reasons: [],
  });
  const evidence = prepareSeriesPackResolvedEvidenceV1(
    profile,
    { ...input, filename },
    range,
  );
  const patterns = {
    ...profile,
    profile: {
      ...profile.profile,
      formatItems: [{ format: 1, name: "literal title", score: 1 }],
    },
    customFormats: [
      {
        id: 1,
        name: "literal title",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "original range",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: true,
            fields: [{ name: "value", value: "S01-S02" }],
          },
        ],
      },
    ],
  };
  expect(regexRequests(patterns, evidence.release)).toEqual([
    { pattern: "S01-S02", value: title },
    { pattern: "S01-S02", value: filename },
  ]);
  expect(
    parseResolvedSeriesPackMemberV1(profile, {
      filename,
      releaseTitle: title,
      coordinates,
      coverage: coordinates.episodes.map((episode) => episode.mediaId),
    }).reasons,
  ).toEqual(["source_parse_unsupported"]);
});
