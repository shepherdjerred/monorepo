import { expect, test } from "vitest";
import { subtitleAccepted } from "./subtitle-quality.ts";
import {
  translateSubtitlePolicy,
  subtitlePolicySatisfaction,
} from "./subtitle-policy.ts";
import { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";

const asset = {
  id: "video",
  checksum: "a".repeat(64),
  version: 2,
  owned: true,
  ownershipEpoch: 3,
  state: "published",
};
const subtitle = {
  assetId: "video",
  language: "en",
  state: "installed",
  qualityStatus: "accepted",
  storageKind: "sidecar",
  ownershipEpoch: 3,
  videoChecksum: asset.checksum,
  videoVersion: 2,
  checksum: "b".repeat(64),
  forced: false,
  hearingImpaired: true,
  streamIndex: null,
  codec: null,
};
test("owned installed legacy files cannot satisfy quality and stale video/epoch bindings fail", () => {
  expect(subtitleAccepted({ subtitle, asset, epoch: 3 })).toBe(true);
  for (const change of [
    { qualityStatus: "unverified" },
    { videoVersion: 1 },
    { videoChecksum: "c".repeat(64) },
    { ownershipEpoch: 2 },
    { storageKind: "unknown" },
  ])
    expect(
      subtitleAccepted({
        subtitle: { ...subtitle, ...change },
        asset,
        epoch: 3,
      }),
    ).toBe(false);
  expect(subtitleAccepted({ subtitle, asset, epoch: 4 })).toBe(false);
  expect(
    subtitleAccepted({
      subtitle: { ...subtitle, storageKind: "embedded", checksum: null },
      asset,
      epoch: 3,
    }),
  ).toBe(false);
});
const source = SubtitleSourceProfileSchema.parse({
  profileId: 7,
  cutoff: null,
  originalFormat: 0,
  constraintHash: "d".repeat(64),
  hasConstraints: false,
  items: [false, true].map((forced, i) => ({
    id: i + 1,
    language: "en",
    forced: forced ? "True" : "False",
    hi: "False",
    audio_exclude: "False",
    audio_only_include: "False",
  })),
});
test("Bazarr 1.6.2 normal HI=False accepts HI while forced target is independently missing", () => {
  const rules = translateSubtitlePolicy(source, "unresolved");
  const input = {
    rules,
    asset,
    epoch: 3,
    audioLanguages: ["en"],
    subtitles: [subtitle],
  };
  expect(
    subtitlePolicySatisfaction(input).missing.map((target) => target.forced),
  ).toEqual([true]);
  expect(
    subtitlePolicySatisfaction({
      ...input,
      subtitles: [
        subtitle,
        { ...subtitle, forced: true, hearingImpaired: false },
      ],
    }).satisfied,
  ).toBe(true);
});
test("generic Chinese policy requires explicit choice, not content validation by relabeling", () => {
  const chinese = {
    ...source,
    items: source.items.map((item) => ({ ...item, language: "zh" })),
  };
  expect(
    translateSubtitlePolicy(chinese, "unresolved").protectedReasons,
  ).toContain("chinese_script_choice_required");
  const rules = translateSubtitlePolicy(chinese, "require_simplified");
  expect(rules.targets.map((target) => target.language)).toEqual([
    "zh-Hans",
    "zh-Hans",
  ]);
  expect(
    subtitlePolicySatisfaction({
      rules,
      asset,
      epoch: 3,
      subtitles: [{ ...subtitle, language: "zh", qualityStatus: "unverified" }],
      audioLanguages: [],
    }).satisfied,
  ).toBe(false);
});
test("cutoff/text/original-format semantics stay protected and unknown audio cannot become an exemption", () => {
  expect(
    translateSubtitlePolicy(
      { ...source, cutoff: 1, hasConstraints: true, originalFormat: 1 },
      "unresolved",
    ).protectedReasons,
  ).toHaveLength(3);
  const rules = translateSubtitlePolicy(
    {
      ...source,
      items: source.items.map((item) => ({
        ...item,
        audio_exclude: "True" as const,
      })),
    },
    "unresolved",
  );
  expect(
    subtitlePolicySatisfaction({
      rules,
      asset,
      epoch: 3,
      subtitles: [],
      audioLanguages: null,
    }).protectedReasons,
  ).toContain("subtitle_audio_evidence_unknown");
  expect(
    subtitlePolicySatisfaction({
      rules,
      asset,
      epoch: 3,
      subtitles: [],
      audioLanguages: ["en"],
    }).satisfied,
  ).toBe(true);
});
