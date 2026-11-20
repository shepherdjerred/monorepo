import type { z } from "zod";
import type {
  ProviderListSchema,
  ProviderStatusSchema,
  SubtitleTargetListSchema,
} from "#shared/admin.ts";
import type { CapacityViewSchema } from "#shared/capacity/view.ts";
import type { BundleReviewListSchema } from "#shared/migration-handoff.ts";
import type {
  MigrationProposalListSchema,
  SourceKindSchema,
} from "#shared/migration.ts";
import type { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type {
  NumberingEpisodeListSchema,
  NumberingSeriesListSchema,
} from "#shared/numbering.ts";
import type { PlexProfilesSchema } from "#shared/plex-admin.ts";
import type { RecoveryListSchema } from "#shared/recovery.ts";
import { definitionDigest, movieScope } from "./movie-requests.ts";
import {
  ALEX,
  KIDS,
  MEMBER,
  OWNER,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import {
  DAY,
  HOUR,
  MINUTE,
  ago,
  ahead,
  fixtureId,
  pick,
  sha256,
} from "#testing/fixture-api/support.ts";
import {
  TITLES,
  episodeId,
  titleItem,
  titleNamed,
  type Title,
} from "./titles.ts";
import { assetId } from "./visibility.ts";

type ProviderStatus = z.input<typeof ProviderStatusSchema>;
type ProviderList = z.input<typeof ProviderListSchema>;
type Capacity = z.input<typeof CapacityViewSchema>;
type PlexProfiles = z.input<typeof PlexProfilesSchema>;
type RecoveryList = z.input<typeof RecoveryListSchema>;
type MigrationList = z.input<typeof MigrationProposalListSchema>;
type MigrationStatus = MigrationList[number]["status"];
type BundleList = z.input<typeof BundleReviewListSchema>;
type SubtitleTargets = z.input<typeof SubtitleTargetListSchema>;
type NumberingSeries = z.input<typeof NumberingSeriesListSchema>;
type NumberingEpisodes = z.input<typeof NumberingEpisodeListSchema>;
type MovieHistoryPending = z.input<typeof MovieHistoryPendingV3Schema>;

function provider(
  id: ProviderStatus["id"],
  kind: ProviderStatus["kind"],
  overrides: Partial<ProviderStatus> = {},
): ProviderStatus {
  const tracker = kind === "tracker";
  return {
    id,
    kind,
    enabled: true,
    configured: true,
    credentialConfigured: true,
    configuration: { minimumIntervalSeconds: 30, dailyDownloadLimit: 10 },
    seedingPolicy: tracker ? { kind: "public" } : { kind: "unknown" },
    updatedAt: ago(12 * DAY),
    lastError: null,
    nextAllowedAt: null,
    feedState: tracker ? "current" : "unsupported_recent_feed",
    lastFeedAt: tracker ? ago(9 * MINUTE) : null,
    ...overrides,
  };
}

const NO_CREDENTIAL = { credentialConfigured: false } as const;
const NEVER_CONFIGURED = {
  enabled: false,
  configured: false,
  credentialConfigured: false,
  updatedAt: null,
} as const;

/** Every provider, across each feed state, error, and seeding policy kind. */
export function providerList(): ProviderList {
  return [
    provider("knaben", "tracker", {
      ...NO_CREDENTIAL,
      configuration: {
        minimumIntervalSeconds: 20,
        dailyDownloadLimit: 50,
        selection: {
          priority: 20,
          minimumSeeders: 5,
          delaySeconds: 1800,
          bypassAtHighestQuality: true,
        },
      },
    }),
    provider("thepiratebay", "tracker", {
      ...NO_CREDENTIAL,
      lastError: "rate-limited",
      nextAllowedAt: ahead(14 * MINUTE),
      feedState: "catching_up",
    }),
    provider("magnetdownload", "tracker", {
      ...NO_CREDENTIAL,
      enabled: false,
      feedState: "paused",
      lastFeedAt: ago(8 * DAY),
    }),
    provider("privatehd", "tracker", {
      configuration: {
        minimumIntervalSeconds: 60,
        dailyDownloadLimit: 8,
        selection: {
          priority: 1,
          minimumSeeders: 1,
          delaySeconds: 0,
          bypassAtHighestQuality: false,
        },
      },
      seedingPolicy: {
        kind: "privatehd",
        verified: true,
        evidence: "Rules page reviewed 2026-10-02: ratio 0.9 or seven days.",
        ratio: 0.9,
      },
    }),
    provider("avistaz", "tracker", {
      seedingPolicy: {
        kind: "private",
        verified: true,
        evidence:
          "Tracker wiki, section Seeding: 1.0 ratio or 72 hours, larger packs longer.",
        ratio: 1,
        minimumSeconds: 259_200,
        combination: "any",
        sizeRule: {
          secondsPerGiB: 3600,
          minimumSeconds: 259_200,
          maximumSeconds: 1_209_600,
        },
      },
      lastError: "authentication",
      feedState: "error",
      lastFeedAt: ago(3 * HOUR),
    }),
    provider("animez", "tracker", {
      ...NEVER_CONFIGURED,
      feedState: "unconfigured",
      lastFeedAt: null,
      seedingPolicy: { kind: "unknown" },
    }),
    provider("opensubtitles", "subtitle", {
      configuration: { minimumIntervalSeconds: 5, dailyDownloadLimit: 200 },
    }),
    provider("assrt", "subtitle", {
      lastError: "unavailable",
      nextAllowedAt: ahead(2 * HOUR),
    }),
    provider("subhd", "subtitle", { lastError: "interaction-required" }),
    provider("zimuku", "subtitle", { ...NO_CREDENTIAL, enabled: false }),
    provider("subf2m", "subtitle", NEVER_CONFIGURED),
  ];
}

/** A healthy movies volume and a television volume with a stale sample. */
export function capacityView(): Capacity {
  return {
    schemaVersion: 1,
    samplingEnabled: true,
    asOf: ago(30_000),
    roles: [
      {
        role: "movies",
        state: "current",
        reason: null,
        sampledAt: ago(4 * MINUTE),
        totalBytes: "87961930563584",
        availableBytes: "19240532279296",
      },
      {
        role: "tv",
        state: "stale",
        reason: "sample_stale",
        sampledAt: ago(3 * DAY),
        totalBytes: null,
        availableBytes: null,
      },
    ],
  };
}

export function plexProfiles(): PlexProfiles {
  return {
    homeUsers: [
      { id: "1", title: OWNER.displayName, restricted: false, protected: true },
      {
        id: "4",
        title: MEMBER.displayName,
        restricted: false,
        protected: false,
      },
      { id: "7", title: KIDS.displayName, restricted: true, protected: false },
      { id: "9", title: "Guest", restricted: true, protected: true },
    ],
    serverAccounts: [
      { id: "1", name: OWNER.displayName },
      { id: "20417733", name: "mei" },
      { id: "20417790", name: "alex" },
      { id: "20417802", name: "sam" },
      { id: "31", name: KIDS.displayName },
    ],
    mappings: [
      {
        userId: OWNER.id,
        globalAccountId: OWNER.plexAccountId,
        displayName: OWNER.displayName,
        serverAccountId: "1",
        homeUserId: "1",
        kind: "account",
        version: 2,
        permittedSectionIds: ["1", "2", "5"],
        verifiedAt: ago(2 * HOUR),
      },
      {
        userId: MEMBER.id,
        globalAccountId: MEMBER.plexAccountId,
        displayName: MEMBER.displayName,
        serverAccountId: "20417733",
        homeUserId: "4",
        kind: "account",
        version: 1,
        permittedSectionIds: ["1", "2"],
        verifiedAt: ago(2 * HOUR),
      },
      {
        userId: ALEX.id,
        globalAccountId: ALEX.plexAccountId,
        displayName: ALEX.displayName,
        serverAccountId: "20417790",
        homeUserId: null,
        kind: "account",
        version: 1,
        permittedSectionIds: ["1"],
        verifiedAt: null,
      },
      {
        userId: KIDS.id,
        globalAccountId: OWNER.plexAccountId,
        displayName: KIDS.displayName,
        serverAccountId: "31",
        homeUserId: "7",
        kind: "managed",
        version: 3,
        permittedSectionIds: ["2"],
        verifiedAt: ago(26 * HOUR),
      },
    ],
  };
}

const HOLD_REASONS = [
  "restored_from_backup",
  "requester_unknown",
  "keep_intent_unverified",
];
const HELD_TITLES = [
  "Blade Runner 2049",
  "The Wire",
  "Interstellar",
  "Cowboy Bebop",
  "Succession",
  "Alien",
];

/** Recovery holds everyone sees; only the owner sees the authority state. */
export function recoveryList(persona: Persona): RecoveryList {
  return {
    authority:
      persona === "owner"
        ? {
            mode: "observe",
            ownershipConfirmed: false,
            writerState: "revoked",
            storageState: "current",
          }
        : null,
    holds: HELD_TITLES.map((title, index) => ({
      mediaId: titleNamed(title).id,
      title,
      reason: pick(HOLD_REASONS, index),
    })),
    reviews: [
      {
        id: fixtureId(16, 1),
        state: "awaiting_review",
        createdAt: ago(2 * DAY),
        titles: ["Breaking Bad", "Better Call Saul"],
      },
      {
        id: fixtureId(16, 2),
        state: "release",
        createdAt: ago(6 * DAY),
        titles: ["The Godfather"],
      },
      {
        id: fixtureId(16, 3),
        state: "closed",
        createdAt: ago(19 * DAY),
        titles: ["Chernobyl", "Fleabag", "Dark"],
      },
    ],
  };
}

type MigrationSeed = readonly [
  kind: z.input<typeof SourceKindSchema>,
  version: string,
  status: MigrationStatus,
  daysAgo: number,
];

const MIGRATIONS: readonly MigrationSeed[] = [
  ["radarr", "5.14.0.9383", "approved", 21],
  ["sonarr", "4.0.11.2680", "awaiting_review", 20],
  ["overseerr", "1.33.2", "protected", 19],
  ["radarr", "5.14.0.9383", "revoked", 34],
];

/** One captured source per review status. */
export function migrationProposals(): MigrationList {
  return MIGRATIONS.map(([kind, version, status, daysAgo], index) => ({
    source: { kind, instanceId: sha256(`instance-${kind}`), version },
    id: fixtureId(17, index + 1),
    captureId: fixtureId(17, 101 + index),
    reportHash: sha256(`report-${String(index + 1)}`),
    captureHash: sha256(`capture-${String(index + 1)}`),
    recoveryEpoch: 1,
    runtimeVersion: 12,
    version: index + 1,
    status,
    createdAt: ago(daysAgo * DAY),
  }));
}

export function migrationBundles(): BundleList {
  return [
    {
      id: fixtureId(18, 1),
      reportHash: sha256("bundle-1"),
      status: "awaiting_review",
      version: 2,
      createdAt: ago(18 * DAY),
    },
    {
      id: fixtureId(18, 2),
      reportHash: sha256("bundle-2"),
      status: "approved",
      version: 4,
      createdAt: ago(30 * DAY),
    },
    {
      id: fixtureId(18, 3),
      reportHash: sha256("bundle-3"),
      status: "protected",
      version: 1,
      createdAt: ago(31 * DAY),
    },
  ];
}

const SUBTITLE_TARGET_LIMIT = 8;

/** Available movies an owner can attach a manual caption file to. */
export function subtitleTargets(query: string): SubtitleTargets {
  const needle = query.toLowerCase();
  return TITLES.filter(
    (title) =>
      title.kind === "movie" &&
      title.availability === "available" &&
      title.title.toLowerCase().includes(needle),
  )
    .slice(0, SUBTITLE_TARGET_LIMIT)
    .map((title) => {
      const asset = assetId(titleItem(title));
      return {
        assetId: asset,
        version: 2,
        checksum: sha256(`asset:${asset}`),
        filename: `${title.title.replaceAll(":", "")} (${String(title.year)}).mkv`,
        titles: [title.title],
        installedLanguages: ["en"],
        subtitles: [
          {
            id: fixtureId(9, 5100 + title.index),
            version: 1,
            state: "installed",
            qualityStatus: "accepted",
            language: "en",
            forced: false,
            hearingImpaired: false,
            providerId: "opensubtitles",
            filename: `${title.title}.en.srt`,
            storageKind: "sidecar",
          },
        ],
      };
    });
}

/** Anime series, whose episodes may need an absolute number assigned. */
export function numberingSeries(query: string): NumberingSeries {
  const needle = query.toLowerCase();
  return TITLES.filter(
    (title) =>
      title.kind === "series" &&
      title.language === "ja" &&
      title.title.toLowerCase().includes(needle),
  ).map((title) => ({ id: title.id, title: title.title, year: title.year }));
}

const NUMBERING_PAGE_SIZE = 12;
const NUMBERED_EPISODES = 8;

export function numberingEpisodes(title: Title): NumberingEpisodes {
  return Array.from({ length: NUMBERING_PAGE_SIZE }, (_, index) => ({
    id: episodeId(title, 1, index + 1),
    title: `Episode ${String(index + 1)}`,
    seasonNumber: 1,
    episodeNumber: index + 1,
    version: 1,
    absoluteNumber: index < NUMBERED_EPISODES ? index + 1 : null,
    evidence: index < NUMBERED_EPISODES ? "anidb" : null,
  }));
}

type HistoryReviewSeed = readonly [
  title: string,
  edition: MovieEditionKey,
  responded: boolean,
  expiresInDays: number,
];

const HISTORY_REVIEWS: readonly HistoryReviewSeed[] = [
  ["Blade Runner", "final_cut", false, 5],
  ["Alien", "directors_cut", true, 9],
  ["Interstellar", "default", false, 2],
];

/** Pending "which cut did you watch" reviews, optionally for one edition. */
export function movieHistoryReviews(
  parameters: URLSearchParams,
): MovieHistoryPending {
  const mediaId = parameters.get("mediaId");
  const edition = parameters.get("edition");
  return {
    reviews: HISTORY_REVIEWS.map(
      ([name, reviewEdition, responded, expiresInDays], index) => {
        const title = titleNamed(name);
        return {
          id: fixtureId(19, index + 1),
          version: index + 1,
          scope: movieScope(title, reviewEdition),
          definition: {
            definitionVersion: 0 as const,
            definitionDigest: definitionDigest(title, reviewEdition),
          },
          title: title.title,
          expiresAt: ahead(expiresInDays * DAY),
          responded,
        };
      },
    ).filter(
      (review) =>
        mediaId === null ||
        (review.scope.mediaId === mediaId && review.scope.edition === edition),
    ),
  };
}
