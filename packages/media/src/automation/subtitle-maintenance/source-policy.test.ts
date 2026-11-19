import { expect, test } from "vitest";
import { subtitleSourceDecisionV1 } from "./source-policy.ts";
import { subtitleProviderCandidateAllowedV1 } from "#domain/subtitle-maintenance/provider.ts";
import { subtitleSourceScoreV1 } from "#domain/subtitle-maintenance/score.ts";
import type { SubtitleScoreReferenceV1 } from "#shared/subtitle-maintenance/score.ts";
const reference: SubtitleScoreReferenceV1 = {
  schemaVersion: 1,
  kind: "movie",
  title: "Example",
  year: 2026,
  season: null,
  episode: null,
  sourceFilename: "Example.2026.1080p.BluRay.x264-TEAM.mkv",
  quality: "bluray-1080p",
  videoCodec: "h264",
  audioCodec: null,
  imdbId: "tt12345",
  tmdbId: null,
  edition: "default",
};
const makeSource = (filename = "Example.2026.1080p.BluRay.x264-TEAM.srt") => ({
  filename,
  description: "Human translated release",
  bytes: new TextEncoder().encode(
    "1\n00:00:01,000 --> 00:00:03,000\nA complete sentence.\n",
  ),
  forced: false,
  actualLanguage: "en",
  hearingImpaired: false,
  declaredEncoding: "utf8" as const,
});
test("real score above movie floor passes; low score remains a definitive rejection", () => {
  const source = makeSource();
  expect(
    subtitleSourceDecisionV1(
      { ...source, matchScoreV1: subtitleSourceScoreV1(reference, source) },
      { language: "en", scoreReferenceV1: reference },
    ).accepted,
  ).toBe(true);
  const low = makeSource("Example.2026.srt");
  expect(
    subtitleSourceDecisionV1(
      { ...low, matchScoreV1: subtitleSourceScoreV1(reference, low) },
      { language: "en", scoreReferenceV1: reference },
    ),
  ).toMatchObject({
    accepted: false,
    definitive: true,
    reason: "subtitle_score_below_minimum",
  });
});
test("foreign provider ID conflict rejects even a high filename score", () => {
  const source = makeSource();
  const matchScoreV1 = subtitleSourceScoreV1(reference, {
    ...source,
    catalogEvidenceV1: {
      kind: "movie",
      imdbId: "tt54321",
      tmdbId: null,
      season: null,
      episode: null,
    },
  });
  expect(
    subtitleSourceDecisionV1(
      { ...source, matchScoreV1 },
      { language: "en", scoreReferenceV1: reference },
    ),
  ).toMatchObject({
    accepted: false,
    definitive: true,
    reason: "subtitle_canonical_identity_conflict",
  });
});
test("reference changes and unknown scores protect without permanent bad-content exclusion", () => {
  const source = makeSource();
  const matchScoreV1 = subtitleSourceScoreV1(reference, source);
  expect(
    subtitleSourceDecisionV1(
      { ...source, matchScoreV1 },
      {
        language: "en",
        scoreReferenceV1: { ...reference, edition: "directors-cut" },
      },
    ),
  ).toMatchObject({
    accepted: false,
    definitive: false,
    reason: "subtitle_score_reference_changed",
  });
  expect(
    subtitleSourceDecisionV1(source, {
      language: "en",
      scoreReferenceV1: reference,
    }),
  ).toMatchObject({
    accepted: false,
    definitive: false,
    reason: "subtitle_score_evidence_unknown",
  });
});
test("upgrades require strictly greater actual score and exclude actual rejected bytes", () => {
  const source = makeSource();
  const matchScoreV1 = subtitleSourceScoreV1(reference, source);
  const scored = { ...source, matchScoreV1 };
  const result = subtitleSourceDecisionV1(scored, {
    language: "en",
    scoreReferenceV1: reference,
    upgradeV1: {
      oldSubtitleId: "a3a1af56-dd14-407f-9d78-f3e9aa685c49",
      oldVersion: 1,
      oldChecksum: "a".repeat(64),
      minimumScore: matchScoreV1,
    },
  });
  expect(result.reason).toBe("subtitle_score_not_improved");
  expect(
    subtitleSourceDecisionV1(scored, {
      language: "en",
      scoreReferenceV1: reference,
      excludedChecksumsV1: [result.checksum],
    }).reason,
  ).toBe("subtitle_checksum_rejected_or_current");
});
test("real rejected provider candidate identities advance traversal without blocking other providers", () => {
  const search = {
    excludedCandidatesV1: [
      { providerId: "subf2m", candidateId: "/subtitles/example/english/123" },
    ],
  };
  expect(
    subtitleProviderCandidateAllowedV1(
      search,
      "subf2m",
      "/subtitles/example/english/123",
    ),
  ).toBe(false);
  expect(
    subtitleProviderCandidateAllowedV1(
      search,
      "subf2m",
      "/subtitles/example/english/124",
    ),
  ).toBe(true);
  expect(
    subtitleProviderCandidateAllowedV1(
      search,
      "subhd",
      "/subtitles/example/english/123",
    ),
  ).toBe(true);
});
