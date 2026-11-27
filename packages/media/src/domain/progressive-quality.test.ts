import { describe, expect, test } from "vitest";
import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import { compareProviderCandidates } from "./provider-selection.ts";
import { chooseUpgrade, evaluateRelease } from "./quality.ts";

const bluRay = {
  id: 7,
  name: "Bluray-1080p",
  source: "bluray",
  resolution: 1080,
};
const remux = {
  id: 31,
  name: "Remux-2160p",
  source: "bluray",
  resolution: 2160,
  modifier: "remux",
};
const profile = {
  id: "living-room",
  version: 1,
  qualities: [bluRay.name],
  rejectedCodecs: [],
  requiredAudioLanguages: [],
  minimumBytes: 0,
  maximumBytes: Number.MAX_SAFE_INTEGER,
  minimumScore: 0,
  cutoffQuality: bluRay.name,
  cutoffScore: 10_000,
  tagScores: {},
  managedGuide: {
    schemaVersion: 1,
    preset: "living-room-v1",
    kind: "movie",
    variant: "standard-1080p",
    revision: "a".repeat(40),
    contentHash: "a".repeat(64),
    scoreOverrides: {},
  },
  resolved: {
    schemaVersion: 1,
    source: "radarr",
    sourceVersion: "6.4.4.10685",
    sourceCommit: "a96bf7c3ecb23cb76993770727285dc17a613fbc",
    capturedAt: "2026-11-27T00:00:00Z",
    snapshotHash: "a".repeat(64),
    properPreference: "preferAndUpgrade",
    profile: {
      id: 1,
      name: "Fixture",
      upgradeAllowed: true,
      cutoff: 7,
      minFormatScore: 0,
      cutoffFormatScore: 10_000,
      minUpgradeFormatScore: 1,
      items: [{ quality: bluRay, allowed: true, items: [] }],
      formatItems: [],
    },
    customFormats: [],
    qualityDefinitions: [
      {
        quality: bluRay,
        title: bluRay.name,
        weight: 19,
        minSize: 50.8,
        maxSize: 80,
      },
      {
        quality: remux,
        title: remux.name,
        weight: 24,
        minSize: 187.4,
        maxSize: 1100,
      },
    ],
    householdPolicy: {
      schemaVersion: 1,
      audio: "original",
      englishCaptionsForForeignAudio: true,
      provisionalUnknownListingAudio: true,
      rejectedFormatIds: [],
    },
  },
} satisfies QualityProfile;

function release(
  id: string,
  qualityId: number,
  sizeBytes: number,
  audioLanguages = ["en"],
): ReleaseAttributes {
  return {
    id,
    providerId: "fixture",
    title: "Avengers: Age of Ultron",
    mediaIds: ["ultron"],
    identityConfidence: "exact",
    quality: qualityId === 7 ? bluRay.name : remux.name,
    codec: "HEVC",
    audioLanguages,
    sizeBytes,
    scoreTags: [],
    videoCompatibility: "compatible",
    resolvedEvidence: {
      schemaVersion: 1,
      source: "radarr",
      sourceVersion: "6.4.4.10685",
      parserVersion: "scene-movie-v4",
      protectedReasons: [],
      regex: {
        engine: "dotnet-ignorecase",
        culture: "en-US",
        observations: [],
      },
      release: {
        id,
        qualityId,
        identityConfirmed: true,
        releaseTitle: "Avengers: Age of Ultron",
        filename: null,
        releaseGroup: null,
        sizeBytes,
        runtimeMinutes: 141,
        audioLanguages,
        originalLanguage: "en",
        revision: { version: 1, real: 0 },
        specialEpisode: false,
      },
    },
  };
}

const tvRemux = {
  id: 30,
  name: "Bluray-1080p Remux",
  source: "blurayRaw",
  resolution: 1080,
};
const tvWeb = { id: 3, name: "WEBDL-1080p", source: "web", resolution: 1080 };
const tvProfile: QualityProfile = {
  ...profile,
  managedGuide: { ...profile.managedGuide, kind: "series" },
  resolved: {
    ...profile.resolved,
    source: "sonarr",
    sourceVersion: "4.0.20.3014",
    sourceCommit: "cab419ade8ac7fcab5bf80394ee492abd35d5f5a",
    profile: {
      ...profile.resolved.profile,
      cutoff: tvWeb.id,
      items: [{ quality: tvWeb, allowed: true, items: [] }],
    },
    qualityDefinitions: [tvRemux, tvWeb].map((quality) => ({
      quality,
      title: quality.name,
      weight: 10,
      minSize: 0,
      maxSize: 80,
    })),
  },
};

function tvRelease(
  id: string,
  qualityId: number,
  sizeBytes: number,
  mediaIds: string[],
) {
  const base = release(id, qualityId, sizeBytes);
  const { resolvedEvidence } = base;
  if (resolvedEvidence === undefined)
    throw new Error("Fixture evidence missing");
  return {
    ...base,
    mediaIds,
    resolvedEvidence: {
      ...resolvedEvidence,
      source: "sonarr" as const,
      sourceVersion: "4.0.20.3014",
      parserVersion: "scene-series-pack-v1" as const,
      release: {
        ...resolvedEvidence.release,
        runtimeMinutes: 50 * mediaIds.length,
      },
    },
  };
}

describe("progressive quality", () => {
  test("accepts under-target and off-profile copies as fallbacks, and still rejects hard failures", () => {
    const compact = release("1080p", 7, 3_479_977_980);
    const uhd = release("2160p", 31, 53_160_957_706);
    expect(evaluateRelease(compact, profile, ["ultron"])).toMatchObject({
      accepted: true,
      fallbackDistanceBytes: 4_030_762_221,
    });
    expect(
      chooseUpgrade({
        candidate: uhd,
        current: null,
        profile,
        mediaIds: ["ultron"],
      }),
    ).toMatchObject({
      upgrade: true,
      reason: "initial_fallback",
    });
    expect(
      evaluateRelease(
        release("wrong-audio", 31, 53_160_957_706, ["fr"]),
        profile,
        ["ultron"],
      ),
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["resolved_original_audio_missing"]),
    });
    expect(
      evaluateRelease(release("oversized", 31, 200_000_000_000), profile, [
        "ultron",
      ]),
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["resolved_size_hard_ceiling_exceeded"]),
    });
    expect(evaluateRelease(uhd, profile, ["wrong-title"])).toMatchObject({
      accepted: false,
    });
  });

  test("keeps a sharper fallback and allows a same-quality copy that fits", () => {
    const fit = release("fit", 7, 10_000_000_000);
    const uhd = release("2160p", 31, 53_160_957_706);
    expect(
      chooseUpgrade({
        candidate: fit,
        current: uhd,
        profile,
        mediaIds: ["ultron"],
      }),
    ).toMatchObject({
      upgrade: false,
      reason: "quality_downgrade",
    });
    expect(
      chooseUpgrade({
        candidate: fit,
        current: release("low", 7, 3_479_977_980),
        profile,
        mediaIds: ["ultron"],
      }),
    ).toMatchObject({
      upgrade: true,
      reason: "fallback_upgrade",
    });
  });

  test("orders fits first and fallbacks by distance before resolution or seeders", () => {
    const close = {
      rank: 1,
      score: 0,
      priority: 25,
      id: "close",
      fallbackDistanceBytes: 1,
      seeders: 1,
    };
    const far = {
      rank: 2,
      score: 100,
      priority: 10,
      id: "far",
      fallbackDistanceBytes: 2,
      seeders: 5,
    };
    const fit = { rank: 0, score: 0, priority: 25, id: "fit", seeders: 1 };
    expect(
      [far, close, fit].sort(compareProviderCandidates).map(({ id }) => id),
    ).toEqual(["fit", "close", "far"]);
  });

  test("uses mapped coverage for a pack listing and the physical file ceiling at inspection", () => {
    const episodes = ["e1", "e2", "e3", "e4", "e5", "e6"];
    const pack = tvRelease("pack", tvWeb.id, 48_000_000_000, episodes);
    expect(evaluateRelease(pack, tvProfile, ["e1"], "listing").accepted).toBe(
      true,
    );
    expect(
      evaluateRelease(pack, tvProfile, episodes, "measured"),
    ).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining(["resolved_size_hard_ceiling_exceeded"]),
    });
  });

  test("keeps a Sonarr remux when the matching WEB copy fits", () => {
    expect(
      chooseUpgrade({
        candidate: tvRelease("web", tvWeb.id, 4_000_000_000, ["e1"]),
        current: tvRelease("remux", tvRemux.id, 12_000_000_000, ["e1"]),
        profile: tvProfile,
        mediaIds: ["e1"],
      }),
    ).toMatchObject({ upgrade: false, reason: "quality_downgrade" });
  });
});
