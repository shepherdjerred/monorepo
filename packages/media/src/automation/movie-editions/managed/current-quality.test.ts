import { expect, test } from "vitest";
import { movieCurrentQuality } from "#automation/movie-editions/current-quality.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import { importResolvedProfiles } from "#migration/profile-import.ts";

const properties = {
  id: "actual-asset",
  providerId: "initial-library",
  title: "Original retained title",
  mediaIds: ["movie"],
  identityConfidence: "exact",
  quality: "WEB-1080p",
  codec: "H264",
  audioLanguages: ["en"],
  sizeBytes: 40_000_000,
  scoreTags: [],
  resolvedEvidence: {
    schemaVersion: 1,
    source: "radarr",
    sourceVersion: "6.4.4.10685",
    parserVersion: "handoff-v1",
    release: {
      id: "actual-asset",
      qualityId: 3,
      identityConfirmed: true,
      releaseTitle: "Original retained title",
      filename: "original.mkv",
      releaseGroup: null,
      sizeBytes: 40_000_000,
      runtimeMinutes: null,
      audioLanguages: ["en"],
      originalLanguage: null,
      revision: null,
      specialEpisode: false,
    },
    protectedReasons: [],
    regex: { engine: "dotnet-ignorecase", culture: "en-US", observations: [] },
  },
};

test("current catalog metadata projects onto measured imported evidence without changing its literal facts", () => {
  const before = JSON.stringify(properties);
  const projected = movieCurrentQuality(properties, {
    runtimeMinutes: 1,
    originalLanguage: "en",
  });
  expect(projected).toEqual({
    ...properties,
    resolvedEvidence: {
      ...properties.resolvedEvidence,
      release: {
        ...properties.resolvedEvidence.release,
        runtimeMinutes: 1,
        originalLanguage: "en",
      },
    },
  });
  expect(projected.resolvedEvidence?.release.revision).toBeNull();
  expect(JSON.stringify(properties)).toBe(before);
});

test("missing current catalog metadata remains protected rather than receiving a guessed duration or language", () => {
  const profile = importResolvedProfiles(snapshot).find(
    (report) => report.source === "radarr",
  )?.profiles[0];
  if (profile === undefined) throw new Error("Actual captured profile missing");
  const projected = movieCurrentQuality(properties, {
    runtimeMinutes: null,
    originalLanguage: null,
  });
  const evidence = projected.resolvedEvidence;
  if (evidence === undefined)
    throw new Error("Measured imported evidence missing");
  expect(evidence.release).toMatchObject({
    runtimeMinutes: null,
    originalLanguage: null,
    revision: null,
  });
  expect(evaluateResolvedRelease(profile, evidence.release).status).toBe(
    "protected",
  );
});

test("unresolved legacy properties remain literal and malformed measured properties fail", () => {
  const { resolvedEvidence: _evidence, ...legacy } = properties;
  expect(
    movieCurrentQuality(legacy, { runtimeMinutes: 1, originalLanguage: "en" }),
  ).toEqual(legacy);
  expect(() =>
    movieCurrentQuality(
      { ...properties, sizeBytes: -1 },
      { runtimeMinutes: 1, originalLanguage: "en" },
    ),
  ).toThrow();
});
