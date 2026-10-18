import { describe, expect, it } from "vitest";
import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import { chooseUpgrade, evaluateRelease } from "./quality.ts";
import { canPublish, changeIntent, planSeasonPack } from "./requests.ts";
import {
  evaluateSeeding,
  privateHdRequiredSeconds,
  SECONDS_PER_DAY,
} from "./seeding.ts";
import { evaluateSubtitle } from "./subtitles.ts";

const profile: QualityProfile = {
  id: "movies",
  version: 1,
  qualities: ["720p", "1080p", "2160p"],
  rejectedCodecs: ["AV1"],
  requiredAudioLanguages: ["en"],
  minimumBytes: 100,
  maximumBytes: 10_000,
  tagScores: { HDR: 20, REPACK: 5 },
  cutoffQuality: "2160p",
  cutoffScore: 20,
  minimumScore: 0,
};
const release: ReleaseAttributes = {
  id: "release",
  providerId: "tracker",
  title: "A film",
  mediaIds: ["movie"],
  identityConfidence: "exact",
  quality: "1080p",
  codec: "HEVC",
  audioLanguages: ["en"],
  sizeBytes: 1000,
  scoreTags: [],
};

describe("release decisions", () => {
  it("rejects release scores below the configured minimum before acquisition", () => {
    const result = evaluateRelease(
      { ...release, scoreTags: ["unwanted"] },
      { ...profile, tagScores: { unwanted: -10_000 } },
      ["movie"],
    );
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("score_below_minimum");
  });
  it("fails loudly for corrupt profile arithmetic", () => {
    expect(() =>
      evaluateRelease(release, { ...profile, cutoffScore: Number.NaN }, [
        "movie",
      ]),
    ).toThrow("invalid numeric rules");
    expect(() =>
      evaluateRelease(release, { ...profile, maximumBytes: -1 }, ["movie"]),
    ).toThrow("invalid numeric rules");
    expect(() =>
      evaluateRelease(release, { ...profile, qualities: ["1080p", "1080p"] }, [
        "movie",
      ]),
    ).toThrow("invalid quality ordering");
  });
  it("rejects ambiguous identity despite superior quality", () => {
    const result = evaluateRelease(
      { ...release, quality: "2160p", identityConfidence: "ambiguous" },
      profile,
      ["movie"],
    );
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("identity_unconfirmed");
  });
  it("requires coverage and hard constraints before scoring", () => {
    const result = evaluateRelease(
      { ...release, codec: "AV1", audioLanguages: [], scoreTags: ["HDR"] },
      profile,
      ["other"],
    );
    expect(result.reasons).toEqual([
      "incomplete_coverage",
      "codec_rejected",
      "audio_language_missing",
    ]);
  });
  it("never counts duplicated release tags twice", () => {
    expect(
      evaluateRelease({ ...release, scoreTags: ["HDR", "HDR"] }, profile, [
        "movie",
      ]).score,
    ).toBe(20);
  });
  it("accepts better quality and stops at both cutoffs", () => {
    const candidate = {
      ...release,
      id: "upgrade",
      quality: "2160p",
      scoreTags: ["HDR"],
    };
    expect(
      chooseUpgrade({
        candidate,
        current: release,
        profile,
        mediaIds: ["movie"],
      }).upgrade,
    ).toBe(true);
    expect(
      chooseUpgrade({
        candidate: { ...candidate, id: "repack", scoreTags: ["HDR", "REPACK"] },
        current: candidate,
        profile,
        mediaIds: ["movie"],
      }).reason,
    ).toBe("cutoff_reached");
  });
  it("does not upgrade equal-ranked releases or trade quality for a repack score", () => {
    expect(
      chooseUpgrade({
        candidate: { ...release, id: "equal" },
        current: release,
        profile,
        mediaIds: ["movie"],
      }).upgrade,
    ).toBe(false);
    expect(
      chooseUpgrade({
        candidate: {
          ...release,
          id: "repack",
          quality: "720p",
          scoreTags: ["HDR", "REPACK"],
        },
        current: release,
        profile,
        mediaIds: ["movie"],
      }).upgrade,
    ).toBe(false);
  });
});

describe("seeding ownership and obligations", () => {
  const torrent = {
    ratio: 0,
    seedingSeconds: 0,
    sizeBytes: 2 * 1024 ** 3,
    complete: true,
    owned: true,
    dependenciesRemaining: false,
  };
  it("preserves PrivateHD decimal-size piecewise minute boundaries", () => {
    expect(privateHdRequiredSeconds(1_000_000_000)).toBe(259_200);
    expect(privateHdRequiredSeconds(2_000_000_000)).toBe(273_600);
    expect(privateHdRequiredSeconds(50_000_000_000)).toBe(619_260);
    expect(
      evaluateSeeding(
        { kind: "privatehd", verified: false, ratio: null },
        { ...torrent, ratio: 100 },
      ).eligible,
    ).toBe(false);
  });
  it("public torrents require ratio one OR seven days", () => {
    expect(evaluateSeeding({ kind: "public" }, torrent).eligible).toBe(false);
    expect(
      evaluateSeeding({ kind: "public" }, { ...torrent, ratio: 1 }).eligible,
    ).toBe(true);
    expect(
      evaluateSeeding(
        { kind: "public" },
        { ...torrent, seedingSeconds: 7 * SECONDS_PER_DAY },
      ).eligible,
    ).toBe(true);
  });
  it("protects unknown policies, unowned torrents, and shared source data", () => {
    expect(
      evaluateSeeding({ kind: "unknown" }, { ...torrent, ratio: 100 }).reason,
    ).toBe("policy_required");
    expect(
      evaluateSeeding(
        { kind: "public" },
        { ...torrent, ratio: 100, owned: false },
      ).eligible,
    ).toBe(false);
    expect(
      evaluateSeeding(
        { kind: "public" },
        { ...torrent, ratio: 100, dependenciesRemaining: true },
      ).eligible,
    ).toBe(false);
  });
  it("applies size-dependent private requirements with all semantics", () => {
    const policy = {
      kind: "private",
      verified: true,
      ratio: 2,
      minimumSeconds: 10,
      combination: "all",
      sizeRule: {
        secondsPerGiB: 100,
        minimumSeconds: 50,
        maximumSeconds: null,
      },
    } satisfies Parameters<typeof evaluateSeeding>[0];
    expect(
      evaluateSeeding(policy, { ...torrent, ratio: 2, seedingSeconds: 199 })
        .eligible,
    ).toBe(false);
    expect(
      evaluateSeeding(policy, { ...torrent, ratio: 2, seedingSeconds: 200 })
        .eligible,
    ).toBe(true);
    expect(
      evaluateSeeding(policy, { ...torrent, ratio: 1, seedingSeconds: 200 })
        .eligible,
    ).toBe(false);
  });
});

describe("request generations and pack sponsorship", () => {
  it("suppresses old acquisitions after removal and requires a new generation to restore", () => {
    const initial = {
      generation: 1,
      desiredPresence: true,
      monitoring: true,
      intentionallyRemoved: false,
    };
    const removed = changeIntent(initial, "remove");
    expect(canPublish(removed, 1)).toBe(false);
    const restored = changeIntent(removed, "request");
    expect(canPublish(restored, 1)).toBe(false);
    expect(canPublish(restored, restored.generation)).toBe(true);
  });
  it("publishes extra pack episodes with sponsor claims while respecting removals", () => {
    const episode = {
      mediaId: "extra",
      identityConfirmed: true,
      intentionallyRemoved: false,
      explicitlyRerequested: false,
      currentIsSuperior: false,
    };
    const results = planSeasonPack({ requestId: "request", userId: "person" }, [
      episode,
      { ...episode, mediaId: "removed", intentionallyRemoved: true },
    ]);
    expect(results[0]).toMatchObject({
      publish: true,
      requesterId: "person",
      sponsorRequestId: "request",
    });
    expect(results[1]).toMatchObject({
      publish: false,
      reason: "intentional_removal",
    });
  });
});

describe("subtitle provenance and version matching", () => {
  const evidence = {
    requestedLanguage: "zh-CN",
    actualLanguage: "zh-CN",
    exactMediaMatch: true,
    videoVersionMatch: true,
    machineLabelled: false,
    traditionalOnlyCharacters: 0,
    simplifiedOnlyCharacters: 10,
    minimumSimplifiedEvidence: 5,
  };
  it("rejects invalid script evidence instead of accepting NaN comparisons", () => {
    expect(() =>
      evaluateSubtitle({ ...evidence, simplifiedOnlyCharacters: Number.NaN }),
    ).toThrow("valid nonnegative counts");
    expect(() =>
      evaluateSubtitle({ ...evidence, minimumSimplifiedEvidence: 0 }),
    ).toThrow("positive threshold");
  });
  it("rejects mixed script despite the provider language label", () => {
    expect(
      evaluateSubtitle({ ...evidence, traditionalOnlyCharacters: 1 }).reasons,
    ).toContain("traditional_script_detected");
  });
  it("does not automatically accept subtitles from a previous video version", () => {
    expect(
      evaluateSubtitle({ ...evidence, videoVersionMatch: false }).accepted,
    ).toBe(false);
    expect(
      evaluateSubtitle({ ...evidence, machineLabelled: true }).accepted,
    ).toBe(false);
    expect(evaluateSubtitle(evidence).accepted).toBe(true);
  });
});
