import type { z } from "zod";
import type { MediaDetailSchema } from "#shared/api.ts";
import type { Availability, MediaItem } from "#shared/contract.ts";
import type { DefaultTargetBatchSchema } from "#shared/editions/target-batch.ts";
import type { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import {
  filmRuntimeMinutes,
  storedArtwork,
  storedOverview,
} from "./artwork.ts";
import { titleFollowers } from "./followers.ts";
import {
  CAPTIONS_MISSING,
  CAPTIONS_SATISFIED,
  CHINESE_CAPTIONS,
} from "./movies/movie-targets.ts";
import {
  OWNER,
  SAM,
  personaUser,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import { PROFILE_IDS } from "./profiles.ts";
import { libraryKeeping, libraryPolicy } from "./library.ts";
import { leavingSoon, removalOf } from "./removals.ts";
import { requestInterest, requestList } from "./requests.ts";
import {
  DAY,
  HOUR,
  ago,
  ahead,
  derivedId,
  fixtureId,
  versionOf,
} from "#testing/fixture-api/support.ts";
import {
  FEATURED,
  ownerKeeps,
  resolveMedia,
  type ResolvedMedia,
} from "./titles.ts";
import { assetId, mediaVisibility } from "./visibility.ts";

type MediaDetail = z.input<typeof MediaDetailSchema>;
type DetailAsset = MediaDetail["assets"][number];
type DetailSubtitle = DetailAsset["asset"]["subtitles"][number];
type DefaultTarget = z.input<typeof DefaultTargetViewSchema>;
type DefaultTargetBatch = z.input<typeof DefaultTargetBatchSchema>;

function subtitle(
  item: MediaItem,
  ordinal: number,
  overrides: Partial<DetailSubtitle> = {},
): DetailSubtitle {
  return {
    id: derivedId(20, item.id, ordinal),
    language: "en",
    providerId: "opensubtitles",
    state: "installed",
    qualityStatus: "accepted",
    storageKind: "sidecar",
    accepted: true,
    forced: false,
    hearingImpaired: false,
    ...overrides,
  };
}

function hasFile(item: MediaItem): boolean {
  return (
    (item.availability === "available" ||
      item.availability === "quarantined") &&
    (item.kind === "movie" || item.kind === "episode")
  );
}

function richAssets(item: MediaItem): DetailAsset[] {
  return [
    {
      current: true,
      edition: "default",
      asset: {
        id: assetId(item),
        properties: {
          quality: "Remux-2160p",
          codec: "hevc",
          container: "mkv",
          sizeBytes: 71_342_556_160,
          audioLanguages: ["en"],
          audio: "TrueHD Atmos 7.1",
          hdr: true,
          runtimeSeconds: 9960,
        },
        state: "published",
        createdAt: ago(40 * DAY),
        subtitleStatus: CAPTIONS_MISSING,
        subtitles: [
          subtitle(item, 1, { hearingImpaired: true }),
          subtitle(item, 2, {
            providerId: "embedded",
            forced: true,
            storageKind: "embedded",
          }),
          subtitle(item, 3, {
            language: "zh-Hans",
            providerId: "assrt",
            state: "quarantined",
            qualityStatus: "rejected",
            accepted: false,
          }),
        ],
      },
    },
    {
      current: false,
      edition: "default",
      asset: {
        id: assetId(item, 2),
        properties: {
          quality: "WEBDL-1080p",
          codec: "h264",
          container: "mkv",
          sizeBytes: 9_874_112_512,
          audioLanguages: ["en"],
          hdr: false,
        },
        state: "superseded",
        createdAt: ago(240 * DAY),
        subtitleStatus: null,
        subtitles: [],
      },
    },
  ];
}

function assets(resolved: ResolvedMedia): DetailAsset[] {
  const { item, title } = resolved;
  if (!hasFile(item)) {
    return [];
  }
  if (title === FEATURED.movie) {
    return richAssets(item);
  }
  return [
    {
      current: true,
      edition: "default",
      asset: {
        id: assetId(item),
        properties: {
          quality: "WEBDL-1080p",
          codec: "h264",
          container: "mkv",
          sizeBytes: 8_214_663_168,
          audioLanguages: ["en"],
          audio: "EAC3 5.1",
          hdr: false,
          runtimeSeconds: 6540,
        },
        state:
          item.availability === "quarantined" ? "quarantined" : "published",
        createdAt: ago(40 * DAY),
        subtitleStatus: CAPTIONS_SATISFIED,
        subtitles: [subtitle(item, 1)],
      },
    },
  ];
}

/** Newest first: the lifecycle events a title in each state has been through. */
const EVENT_KINDS: Record<Availability, readonly string[]> = {
  available: [
    "media_upgraded",
    "subtitles_ready",
    "media_available",
    "import_completed",
    "download_started",
    "release_selected",
    "request_created",
  ],
  downloading: [
    "download_started",
    "release_selected",
    "search_completed",
    "request_created",
  ],
  searching: [
    "acquisition_failed",
    "search_completed",
    "search_started",
    "request_created",
  ],
  wanted: ["request_created"],
  validating: [
    "validation_started",
    "download_completed",
    "download_started",
    "request_created",
  ],
  importing: [
    "import_started",
    "download_completed",
    "download_started",
    "request_created",
  ],
  quarantined: [
    "files_quarantined",
    "removal_warning",
    "media_available",
    "request_created",
  ],
  removed: [
    "files_purged",
    "files_quarantined",
    "media_available",
    "request_created",
  ],
};

function holds(
  resolved: ResolvedMedia,
  persona: Persona,
): MediaDetail["holds"] {
  const { item, title } = resolved;
  if (ownerKeeps(title) && item.id === title.id) {
    // A member reads only their own holds, and this one is the owner's.
    return persona === "owner"
      ? [
          {
            id: fixtureId(9, 7000 + title.index),
            userId: OWNER.id,
            until: null,
            isPin: true,
          },
        ]
      : [];
  }
  if (title === FEATURED.series && item.kind === "series") {
    return [
      {
        id: fixtureId(9, 7002),
        userId: personaUser(persona).id,
        until: ahead(22 * DAY),
        isPin: false,
      },
    ];
  }
  return [];
}

function retention(resolved: ResolvedMedia): MediaDetail["retention"] {
  const { item, title } = resolved;
  const id = fixtureId(9, 7100 + title.index);
  if (item.availability === "quarantined") {
    return [
      {
        id,
        state: "quarantined",
        graceUntil: ago(2 * DAY),
        purgeAfter: ahead(5 * DAY),
        version: 2,
      },
    ];
  }
  // A removal is decided for the title, not for its seasons and episodes.
  const removal = item.id === title.id ? removalOf(title) : null;
  return removal === null || removal.state === "quarantined"
    ? []
    : [{ id, ...removal, version: 1 }];
}

/**
 * The reader's requests the detail read lists: those that still follow their
 * title. One whose interest was let go or ran out still stands, but is not
 * among them.
 */
function followingRequests(persona: Persona) {
  return requestList(persona).filter(
    (request) =>
      request.active &&
      requestInterest(request.id, persona).interestState === "following",
  );
}

function requesters(
  resolved: ResolvedMedia,
  persona: Persona,
): MediaDetail["requests"] {
  const { item, title } = resolved;
  const user = personaUser(persona);
  const standing = followingRequests(persona);
  const own = standing
    .filter((request) => request.mediaId === item.id)
    .map((request) => ({
      id: request.id,
      userId: request.userId,
      subtitleLanguages: request.subtitleLanguages,
      version: request.version,
      user: { displayName: user.displayName },
      ...requestInterest(request.id, persona),
    }));
  if (item.id !== title.id) {
    // A request for the whole series reaches each of its seasons and episodes
    // as a row with no interest of its own: that stays on the series' request.
    const series = standing.find((request) => request.mediaId === title.id);
    return series === undefined || own.length > 0
      ? own
      : [
          {
            id: derivedId(23, item.id, 1),
            userId: series.userId,
            subtitleLanguages: series.subtitleLanguages,
            version: 1,
            user: { displayName: user.displayName },
            interestRevision: null,
            interestState: null,
            keepingPolicy: null,
          },
        ];
  }
  // The featured titles are also wanted by another household member, whose
  // request only the owner reads: a member sees their own.
  const shared = fixtureId(5, 900 + title.index);
  return persona === "owner" &&
    (title === FEATURED.movie || title === FEATURED.series)
    ? [
        ...own,
        {
          id: shared,
          userId: SAM.id,
          subtitleLanguages: ["en"],
          version: 1,
          user: { displayName: SAM.displayName },
          ...requestInterest(shared, persona),
        },
      ]
    : own;
}

/** A film's runtime, or an episode's own; a series and a season have none. */
function runtimeMinutes(resolved: ResolvedMedia): number | null {
  const { item, title } = resolved;
  if (item.kind === "movie") return filmRuntimeMinutes(title.tmdbId);
  return item.kind === "episode" ? 42 + versionOf(item.id) * 3 : null;
}

/** Everything the title page shows for a movie, series, season, or episode. */
export function mediaDetail(
  resolved: ResolvedMedia,
  persona: Persona,
): MediaDetail {
  const { item, title, children } = resolved;
  const featured = title === FEATURED.movie || title === FEATURED.series;
  const removed = item.availability === "removed";
  return {
    ...item,
    // A season or episode page shows its series' art, synopsis and catalog link.
    rootMediaId: title.id,
    artwork: storedArtwork(title),
    overview: storedOverview(title),
    runtimeMinutes: runtimeMinutes(resolved),
    catalog: { kind: title.kind, externalId: title.tmdbId },
    // A season or episode page reports its series' keeping, as the library does.
    policy: libraryPolicy(title),
    libraryKeeping: libraryKeeping(title, persona),
    followers: titleFollowers(title, persona),
    visibility: mediaVisibility(resolved, persona),
    subtitlePolicies: featured
      ? [
          {
            id: fixtureId(9, 6000 + title.index),
            version: 2,
            recoveryEpoch: 1,
            rules: {
              schemaVersion: 1,
              targets: [CHINESE_CAPTIONS],
              protectedReasons: [],
            },
          },
        ]
      : [],
    children,
    intent: {
      generation: 3,
      desiredPresence: !removed,
      monitoring: !removed && item.availability !== "quarantined",
      profileId:
        item.kind === "movie" ? PROFILE_IDS.movies4k : PROFILE_IDS.series4k,
      version: 4,
      intentionallyRemovedAt: removed ? ago(20 * DAY) : null,
    },
    requests: requesters(resolved, persona),
    holds: holds(resolved, persona),
    retention: retention(resolved),
    // What the owner confirms to take an available series, season or episode
    // out of the library. A film is removed one edition at a time instead.
    ...(persona === "owner" &&
    item.kind !== "movie" &&
    item.availability === "available"
      ? {
          removalConfirmation: {
            media: [
              {
                id: item.id,
                title: item.title,
                version: item.version,
                generation: 3,
              },
            ],
            assets: [],
          },
        }
      : {}),
    watchStates:
      item.availability === "available"
        ? [
            {
              userId: personaUser(persona).id,
              watched: true,
              observedAt: ago(6 * DAY),
            },
            { userId: SAM.id, watched: false, observedAt: ago(2 * DAY) },
          ]
        : [],
    assets: assets(resolved),
    events: EVENT_KINDS[item.availability].map((kind, index) => ({
      id: derivedId(21, item.id, index),
      kind,
      createdAt: ago((index * index + 1) * 9 * HOUR),
    })),
  };
}

function protectiveActions(viewer: {
  owner: boolean;
  pinned: boolean;
  requested: boolean;
  leaving: boolean;
}): DefaultTarget["allowedProtectiveActions"] {
  if (viewer.owner) {
    return ["keep", viewer.pinned ? "unpin" : "pin", "cancel_request"];
  }
  if (viewer.requested) {
    return ["keep", "cancel_request"];
  }
  // Anyone may hold a title that is leaving soon, whoever asked for it.
  return viewer.leaving ? ["keep"] : [];
}

/** The protective controls for a title's unmarked edition. */
export function defaultTarget(
  resolved: ResolvedMedia,
  persona: Persona,
): DefaultTarget {
  const { item, title } = resolved;
  const owner = persona === "owner";
  const ownRequests = requestList(persona)
    .filter((request) => request.mediaId === item.id)
    .map((request) => ({
      id: request.id,
      version: request.version,
      active: request.active,
      canCancel: request.active,
    }));
  const common = {
    schemaVersion: 2,
    scope: { mediaId: item.id, edition: "default" },
    expected: { mediaVersion: item.version, targetVersion: 4 },
    ownRequests,
    allowedProtectiveActions: protectiveActions({
      owner,
      pinned: owner && ownerKeeps(title) && item.id === title.id,
      requested: ownRequests.some((request) => request.active),
      leaving: item.id === title.id && leavingSoon(title) !== null,
    }),
  } as const;
  if (title === FEATURED.protectionOnly) {
    return { ...common, access: "protection_only" };
  }
  return {
    ...common,
    access: "detail",
    target: {
      generation: 3,
      availability: item.availability,
      lineage: "resolved",
    },
  };
}

/** The same controls for a list of titles; an unknown id is reported, not dropped. */
export function defaultTargetBatch(
  mediaIds: readonly string[],
  persona: Persona,
): DefaultTargetBatch {
  return {
    schemaVersion: 2,
    items: mediaIds.map((mediaId) => {
      const resolved = resolveMedia(mediaId);
      return resolved === null
        ? { status: "unavailable", mediaId, code: "media_not_found" }
        : { status: "ok", view: defaultTarget(resolved, persona) };
    }),
  };
}
