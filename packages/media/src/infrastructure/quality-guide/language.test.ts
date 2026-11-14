import { expect, test } from "vitest";
import fixture from "#domain/quality-guide/guide-fixture.json";
import { compileQualityGuide } from "#domain/quality-guide/compile.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import { evaluateRelease, chooseUpgrade } from "#domain/quality.ts";
import { prepareResolvedEvidence } from "#migration/runtime-evidence.ts";
import type { ResolvedRelease } from "#domain/resolved-contract.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";

const compiled = compileQualityGuide("series", {
  revision: fixture.revision,
  committedAt: fixture.committedAt,
  ...fixture.sources.series,
});
const profile = compiled.rules.resolved;
if (profile === undefined) throw new Error("Missing resolved guide fixture");
const release: ResolvedRelease = {
  id: "fixture",
  qualityId: 18,
  identityConfirmed: true,
  releaseTitle: "Example.S01E01.2160p.WEB-DL.HEVC-GROUP",
  filename: "",
  releaseGroup: "GROUP",
  sizeBytes: 5 * 1024 ** 3,
  runtimeMinutes: 40,
  audioLanguages: ["en"],
  originalLanguage: "en",
  revision: { version: 1, real: 0 },
  specialEpisode: false,
};
const noTitleMatches = () => "no_match" as const;

test.each([
  ["en", ["eng"]],
  ["en", ["en-US"]],
  ["ja", ["jpn"]],
  ["zh", ["zho"]],
  ["zh", ["chi"]],
  ["zh", ["zh-Hant"]],
])(
  "catalog %s accepts normalized measured tracks %j",
  (originalLanguage, audioLanguages) => {
    expect(
      evaluateResolvedRelease(
        profile,
        { ...release, originalLanguage, audioLanguages },
        noTitleMatches,
      ).status,
    ).toBe("accepted");
  },
);

test("unknown listing audio is provisional, but the measured boundary stays protected", () => {
  const unknown = { ...release, audioLanguages: null };
  expect(
    evaluateResolvedRelease(profile, unknown, noTitleMatches, "listing").status,
  ).toBe("accepted");
  expect(
    evaluateResolvedRelease(profile, unknown, noTitleMatches).reasons,
  ).toContain("language_evidence_unknown");
  expect(
    evaluateResolvedRelease(
      profile,
      { ...unknown, originalLanguage: "und" },
      noTitleMatches,
      "listing",
    ).reasons,
  ).toContain("language_evidence_unknown");
  expect(
    evaluateResolvedRelease(
      profile,
      { ...unknown, identityConfirmed: false },
      noTitleMatches,
      "listing",
    ).status,
  ).toBe("protected");
});
test("foreign originals may include English, but an English dub alone never replaces original audio", () => {
  expect(
    evaluateResolvedRelease(
      profile,
      { ...release, originalLanguage: "ja", audioLanguages: ["ja", "en"] },
      noTitleMatches,
    ).status,
  ).toBe("accepted");
  expect(
    evaluateResolvedRelease(
      profile,
      { ...release, originalLanguage: "ja", audioLanguages: ["en"] },
      noTitleMatches,
      "listing",
    ).reasons,
  ).toContain("original_audio_missing");
  expect(
    evaluateResolvedRelease(
      profile,
      { ...release, audioLanguages: ["ja"] },
      noTitleMatches,
    ).reasons,
  ).toContain("original_audio_missing");
});
test("physical evaluation requires video compatibility and preserves unknown existing playable evidence", () => {
  const neutral = structuredClone(profile);
  neutral.profile.formatItems = neutral.profile.formatItems.map((row) => ({
    ...row,
    score: 0,
  }));
  const evidence = prepareResolvedEvidence(neutral, {
    id: release.id,
    title: release.releaseTitle ?? "",
    identityConfirmed: true,
    sizeBytes: release.sizeBytes ?? 1,
    runtimeMinutes: 40,
    originalLanguage: "en",
    audioLanguages: ["en"],
    specialEpisode: false,
  });
  const candidate: ReleaseAttributes = {
    id: "next",
    providerId: "fixture",
    title: release.releaseTitle ?? "",
    mediaIds: ["media"],
    identityConfidence: "exact",
    quality: "WEB-2160p",
    codec: "HEVC",
    audioLanguages: ["en"],
    sizeBytes: 5 * 1024 ** 3,
    scoreTags: [],
    resolvedEvidence: evidence,
  };
  const policy = {
    ...compiled.rules,
    id: "profile",
    version: 1,
    resolved: neutral,
  };
  expect(
    evaluateRelease(candidate, policy, ["media"], "listing").accepted,
  ).toBe(true);
  expect(evaluateRelease(candidate, policy, ["media"]).reasons).toContain(
    "resolved_video_compatibility_unknown",
  );
  expect(
    evaluateRelease(
      { ...candidate, videoCompatibility: "incompatible" },
      policy,
      ["media"],
    ).reasons,
  ).toContain("resolved_incompatible_dynamic_range");
  expect(
    evaluateRelease(
      { ...candidate, videoCompatibility: "compatible" },
      policy,
      ["media"],
    ).accepted,
  ).toBe(true);
  expect(
    chooseUpgrade({
      candidate: { ...candidate, videoCompatibility: "compatible" },
      current: { ...candidate, id: "prior" },
      profile: policy,
      mediaIds: ["media"],
      phase: "listing",
    }).reason,
  ).toBe("current_evidence_unknown");
});
