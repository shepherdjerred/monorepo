import { describe, expect, it } from "vitest";
import type { ResolvedProfile, ResolvedRelease } from "./resolved-contract.ts";
import { bytesPerMinute, evaluateResolvedRelease } from "./resolved-quality.ts";
import { chooseResolvedUpgrade } from "./resolved-upgrade.ts";

const web = { id: 3, name: "WEB-DL", source: "web", resolution: 1080 };
const rip = { id: 15, name: "WEBRip", source: "webRip", resolution: 1080 };
const bluray = { id: 7, name: "Bluray", source: "bluray", resolution: 1080 };
const leaf = (quality: typeof web) => ({ quality, allowed: true, items: [] });
const profile: ResolvedProfile = {
  schemaVersion: 1,
  source: "sonarr",
  sourceVersion: "4.0.20.3014",
  sourceCommit: "a".repeat(40),
  capturedAt: "2026-10-17T00:00:00.000Z",
  snapshotHash: "a".repeat(64),
  properPreference: "preferAndUpgrade",
  profile: {
    id: 1,
    name: "fixture",
    upgradeAllowed: true,
    cutoff: 1002,
    minFormatScore: 0,
    cutoffFormatScore: 100,
    minUpgradeFormatScore: 20,
    items: [
      { id: 1002, name: "WEB", allowed: true, items: [leaf(web), leaf(rip)] },
      leaf(bluray),
    ],
    formatItems: [{ format: 1, name: "group bonus", score: 50 }],
  },
  qualityDefinitions: [web, rip, bluray].map((quality) => ({
    quality,
    title: quality.name,
    weight: 1,
    minSize: 1,
    maxSize: 10,
  })),
  customFormats: [
    {
      id: 1,
      name: "group bonus",
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: "group",
          implementation: "ReleaseGroupSpecification",
          negate: false,
          required: true,
          fields: [{ name: "value", value: "GROUP" }],
        },
      ],
    },
  ],
};
const release: ResolvedRelease = {
  id: "candidate",
  qualityId: 3,
  identityConfirmed: true,
  releaseTitle: "Fixture",
  filename: "",
  releaseGroup: "GROUP",
  sizeBytes: 200 * 1024 * 1024,
  runtimeMinutes: 40,
  audioLanguages: ["en"],
  originalLanguage: "en",
  revision: { version: 1, real: 0 },
  specialEpisode: false,
};
const matcher = (pattern: string, value: string) =>
  pattern === value ? "match" : "no_match";
const current = { ...release, id: "current", releaseGroup: "OTHER" };

describe("resolved source policy", () => {
  it("uses duration-based binary MiB bounds and .NET midpoint rounding", () => {
    expect(bytesPerMinute(2.5 / 1024 / 1024)).toBe(2);
    expect(bytesPerMinute(3.5 / 1024 / 1024)).toBe(4);
    expect(
      evaluateResolvedRelease(
        profile,
        { ...release, sizeBytes: 40 * 1024 * 1024 - 1 },
        matcher,
      ).reasons,
    ).toContain("size_below_minimum");
    expect(
      evaluateResolvedRelease(
        profile,
        { ...release, sizeBytes: 400 * 1024 * 1024 + 1 },
        matcher,
      ).reasons,
    ).toContain("size_above_maximum");
    expect(
      evaluateResolvedRelease(
        profile,
        { ...release, runtimeMinutes: null },
        matcher,
      ).status,
    ).toBe("protected");
  });
  it("holds equal-rank WEB qualities to score improvement, and stops quality upgrades at cutoff", () => {
    expect(
      chooseResolvedUpgrade({
        profile,
        candidate: { ...release, qualityId: 15 },
        current,
        matcher,
      }).reason,
    ).toBe("format_upgrade");
    expect(
      chooseResolvedUpgrade({
        profile,
        candidate: { ...release, qualityId: 7 },
        current,
        matcher,
      }).reason,
    ).toBe("quality_cutoff_reached");
    expect(
      chooseResolvedUpgrade({
        profile,
        candidate: release,
        current: { ...current, qualityId: 7 },
        matcher,
      }).reason,
    ).toBe("quality_downgrade");
  });
  it("applies score minimums and minimum upgrade deltas separately", () => {
    const delta = {
      ...profile,
      profile: { ...profile.profile, minUpgradeFormatScore: 51 },
    };
    expect(
      chooseResolvedUpgrade({
        profile: delta,
        candidate: release,
        current,
        matcher,
      }).reason,
    ).toBe("minimum_score_increment");
    const minimum = {
      ...profile,
      profile: { ...profile.profile, minFormatScore: 51 },
    };
    expect(
      evaluateResolvedRelease(minimum, release, matcher).reasons,
    ).toContain("score_below_minimum");
  });
  it("preserves source revision exceptions and protects missing revision evidence", () => {
    const disabled = {
      ...profile,
      profile: { ...profile.profile, upgradeAllowed: false },
    };
    expect(
      chooseResolvedUpgrade({
        profile: disabled,
        candidate: { ...release, revision: { version: 2, real: 0 } },
        current,
        matcher,
      }).reason,
    ).toBe("revision_upgrade");
    expect(
      chooseResolvedUpgrade({
        profile,
        candidate: { ...release, revision: null },
        current,
        matcher,
      }).reason,
    ).toBe("revision_unknown");
    expect(
      chooseResolvedUpgrade({
        profile,
        candidate: release,
        current: { ...current, revision: { version: 1, real: 1 } },
        matcher,
      }).reason,
    ).toBe("revision_downgrade");
  });
});

it("allows an explicit higher quality below cutoff without fabricating the imported file's revision", () => {
  const higher = {
    ...profile,
    profile: { ...profile.profile, cutoff: bluray.id },
  };
  const imported = { ...current, revision: null };
  const candidate = { ...release, qualityId: bluray.id, revision: null };
  expect(
    chooseResolvedUpgrade({
      profile: higher,
      candidate,
      current: imported,
      matcher,
    }),
  ).toMatchObject({ upgrade: true, reason: "quality_upgrade" });
  expect(imported.revision).toBeNull();
  expect(
    chooseResolvedUpgrade({
      profile: higher,
      candidate: { ...candidate, qualityId: web.id },
      current: imported,
      matcher,
    }),
  ).toMatchObject({ upgrade: false, reason: "revision_unknown" });
  expect(
    chooseResolvedUpgrade({
      profile: {
        ...higher,
        profile: { ...higher.profile, upgradeAllowed: false },
      },
      candidate,
      current: imported,
      matcher,
    }).upgrade,
  ).toBe(false);
  expect(
    chooseResolvedUpgrade({ profile, candidate, current: imported, matcher })
      .upgrade,
  ).toBe(false);
});
describe("resolved format and language evidence", () => {
  it("requires known original language and actual audio evidence", () => {
    const original: ResolvedProfile = {
      ...profile,
      source: "radarr",
      profile: { ...profile.profile, language: { id: -2, name: "Original" } },
    };
    expect(
      evaluateResolvedRelease(
        original,
        { ...release, originalLanguage: null },
        matcher,
      ).status,
    ).toBe("protected");
    expect(
      evaluateResolvedRelease(
        original,
        { ...release, audioLanguages: ["fr"] },
        matcher,
      ).reasons,
    ).toContain("original_audio_missing");
  });
  it("does not invert unknown or unsupported negated format evidence into acceptance", () => {
    const unknown = structuredClone(profile);
    const spec = unknown.customFormats[0]?.specifications[0];
    if (spec === undefined) throw new Error("Missing fixture rule");
    spec.negate = true;
    expect(
      evaluateResolvedRelease(
        unknown,
        { ...release, releaseGroup: null },
        matcher,
      ).status,
    ).toBe("protected");
    spec.implementation = "FutureSpecification";
    expect(evaluateResolvedRelease(unknown, release, matcher).status).toBe(
      "protected",
    );
    expect(evaluateResolvedRelease(profile, release).status).toBe("protected");
  });
  it("ANDs specification types and requires every required rule plus at least one rule per type", () => {
    const rules = structuredClone(profile);
    const format = rules.customFormats[0];
    if (format === undefined) throw new Error("Missing fixture format");
    format.specifications.push({
      name: "other group",
      implementation: "ReleaseGroupSpecification",
      negate: false,
      required: false,
      fields: [{ name: "value", value: "OTHER" }],
    });
    expect(evaluateResolvedRelease(rules, current, matcher).score).toBe(0);
    format.specifications.push({
      name: "resolution",
      implementation: "ResolutionSpecification",
      negate: false,
      required: false,
      fields: [{ name: "value", value: 2160 }],
    });
    expect(evaluateResolvedRelease(rules, release, matcher).score).toBe(0);
  });
  it("rejects malformed numeric metadata rather than making a policy decision", () => {
    expect(() =>
      evaluateResolvedRelease(
        profile,
        { ...release, sizeBytes: Number.NaN },
        matcher,
      ),
    ).toThrow();
  });
});
