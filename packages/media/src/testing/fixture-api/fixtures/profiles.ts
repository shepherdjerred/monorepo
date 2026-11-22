import type { z } from "zod";
import type {
  ProfileDefaultsSchema,
  ProfileListSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import type {
  ManagedGuide,
  QualityGuideKind,
} from "#shared/quality-guide/contract.ts";
import type { QualityGuideStatusSchema } from "#shared/quality-guide/view.ts";
import {
  DAY,
  GIBIBYTE,
  HOUR,
  ago,
  fixtureId,
  sha1,
  sha256,
} from "#testing/fixture-api/support.ts";

/** Hand-written rules: the fields every profile has, as plain JSON. */
type QualityRules = Omit<
  z.input<typeof QualityRulesSchema>,
  "resolved" | "managedGuide"
>;
type ManagedRules = QualityRules & { managedGuide: ManagedGuide };
type ProfileList = z.input<typeof ProfileListSchema>;
type ProfileDefaults = z.input<typeof ProfileDefaultsSchema>;
type QualityGuideStatus = z.input<typeof QualityGuideStatusSchema>;

export const PROFILE_IDS = {
  movies4k: fixtureId(15, 1),
  moviesHd: fixtureId(15, 2),
  series4k: fixtureId(15, 3),
  anime: fixtureId(15, 4),
  captured: fixtureId(15, 5),
} as const;

function managedGuide(kind: QualityGuideKind): ManagedGuide {
  return {
    schemaVersion: 1,
    preset: "living-room-v1",
    kind,
    revision: sha1(`guide-${kind}`),
    contentHash: sha256(`guide-content-${kind}`),
    scoreOverrides: {
      [sha256("format-x265-hd").slice(0, 32)]: -10_000,
      [sha256("format-atmos").slice(0, 32)]: 250,
    },
  };
}

type RuleSeed = {
  qualities: string[];
  maximumGibibytes: number;
  audioLanguages?: string[];
};

/**
 * Rules whose best quality is also the upgrade cutoff. Qualities are listed
 * the way the rules store them: least wanted first.
 */
function rules(seed: RuleSeed): QualityRules {
  const cutoffQuality = seed.qualities.at(-1);
  if (cutoffQuality === undefined) {
    throw new Error("A quality profile needs at least one quality");
  }
  return {
    qualities: seed.qualities,
    rejectedCodecs: ["xvid", "divx"],
    requiredAudioLanguages: seed.audioLanguages ?? ["en"],
    minimumBytes: 700 * 1024 ** 2,
    maximumBytes: seed.maximumGibibytes * GIBIBYTE,
    minimumScore: 0,
    tagScores: {
      "remux-tier-01": 1900,
      "web-tier-01": 1700,
      "dv-hdr10": 1500,
      "truehd-atmos": 500,
      "x265-hd": -10_000,
      lq: -10_000,
    },
    cutoffQuality,
    cutoffScore: 3500,
  };
}

/** Rules kept in step with the published quality guide. */
function managedRules(seed: RuleSeed, kind: QualityGuideKind): ManagedRules {
  return { ...rules(seed), managedGuide: managedGuide(kind) };
}

const MOVIES_4K = "Living room 4K — Movies";
const SERIES_4K = "Living room 4K — TV";

const HD_1080P = { name: "Bluray-1080p", source: "bluray", resolution: 1080 };
const WEB_1080P = { name: "WEBDL-1080p", source: "webdl", resolution: 1080 };

/** A profile as Radarr held it, captured whole when the library moved here. */
function capturedProfile(): ResolvedProfile {
  return {
    schemaVersion: 1,
    source: "radarr",
    sourceVersion: "6.4.4.10685",
    sourceCommit: sha1("radarr-source"),
    capturedAt: ago(40 * DAY),
    snapshotHash: sha256("radarr-snapshot"),
    properPreference: "doNotPrefer",
    profile: {
      id: 4,
      name: "HD-1080p",
      upgradeAllowed: true,
      cutoff: 7,
      minFormatScore: 0,
      cutoffFormatScore: 0,
      minUpgradeFormatScore: 1,
      items: [
        { quality: { id: 3, ...WEB_1080P }, allowed: true, items: [] },
        { quality: { id: 7, ...HD_1080P }, allowed: true, items: [] },
      ],
      formatItems: [{ format: 12, name: "x265 (HD)", score: -10_000 }],
    },
    customFormats: [
      {
        id: 12,
        name: "x265 (HD)",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "x265",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: true,
            fields: [{ name: "value", value: "[xh][ ._-]?265|HEVC" }],
          },
        ],
      },
    ],
    qualityDefinitions: [
      {
        quality: { id: 3, ...WEB_1080P },
        title: "WEBDL-1080p",
        weight: 9,
        minSize: 0,
        maxSize: 400,
        preferredSize: 95,
      },
      {
        quality: { id: 7, ...HD_1080P },
        title: "Bluray-1080p",
        weight: 10,
        minSize: 0,
        maxSize: 400,
        preferredSize: 95,
      },
    ],
  };
}

/**
 * Two guide-managed living-room profiles, two hand-written ones, and one
 * that carries the Radarr profile it was captured from.
 */
const QUALITY_RULES = {
  movies4k: managedRules(
    {
      qualities: [
        "WEBDL-1080p",
        "Bluray-1080p",
        "WEBDL-2160p",
        "Bluray-2160p",
        "Remux-2160p",
      ],
      maximumGibibytes: 95,
    },
    "movie",
  ),
  moviesHd: rules({
    qualities: ["WEBDL-720p", "WEBDL-1080p", "Bluray-1080p"],
    maximumGibibytes: 25,
  }),
  series4k: managedRules(
    {
      qualities: ["HDTV-1080p", "WEBDL-1080p", "Bluray-1080p", "WEBDL-2160p"],
      maximumGibibytes: 30,
    },
    "series",
  ),
  anime: rules({
    qualities: ["HDTV-1080p", "WEBDL-1080p", "Bluray-1080p"],
    maximumGibibytes: 12,
    audioLanguages: ["ja"],
  }),
  captured: {
    ...rules({
      qualities: ["WEBDL-1080p", "Bluray-1080p"],
      maximumGibibytes: 40,
    }),
    resolved: capturedProfile(),
  },
};

export function profileList(): ProfileList {
  return [
    {
      id: PROFILE_IDS.movies4k,
      name: MOVIES_4K,
      version: 7,
      rules: QUALITY_RULES.movies4k,
    },
    {
      id: PROFILE_IDS.moviesHd,
      name: "HD 1080p — Movies",
      version: 3,
      rules: QUALITY_RULES.moviesHd,
    },
    {
      id: PROFILE_IDS.series4k,
      name: SERIES_4K,
      version: 5,
      rules: QUALITY_RULES.series4k,
    },
    {
      id: PROFILE_IDS.anime,
      name: "Anime 1080p",
      version: 2,
      rules: QUALITY_RULES.anime,
    },
    {
      id: PROFILE_IDS.captured,
      name: "HD-1080p from Radarr",
      version: 1,
      rules: QUALITY_RULES.captured,
    },
  ];
}

export function profileDefaults(): ProfileDefaults {
  return [
    { kind: "movie", profileId: PROFILE_IDS.movies4k, version: 2 },
    { kind: "series", profileId: PROFILE_IDS.series4k, version: 1 },
  ];
}

/** One guide sync that updated and one that failed validation. */
export function qualityGuideStatus(): QualityGuideStatus {
  const movie = managedGuide("movie");
  const series = managedGuide("series");
  return [
    {
      id: PROFILE_IDS.movies4k,
      name: MOVIES_4K,
      version: 7,
      kind: "movie",
      revision: movie.revision,
      contentHash: movie.contentHash,
      lastSync: {
        status: "updated",
        at: ago(7 * HOUR),
        revision: movie.revision,
        reason: null,
      },
      scoreOverrides: movie.scoreOverrides,
    },
    {
      id: PROFILE_IDS.series4k,
      name: SERIES_4K,
      version: 5,
      kind: "series",
      revision: series.revision,
      contentHash: series.contentHash,
      lastSync: {
        status: "failed",
        at: ago(7 * HOUR),
        revision: null,
        reason: "guide_validation_failed",
      },
      scoreOverrides: series.scoreOverrides,
    },
  ];
}
