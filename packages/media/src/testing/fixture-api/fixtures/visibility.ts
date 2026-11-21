import type { MediaItem } from "#shared/contract.ts";
import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { movieRequestsFor } from "./movie-requests.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { requestId } from "./requests.ts";
import {
  DAY,
  HOUR,
  MINUTE,
  ago,
  derivedId,
} from "#testing/fixture-api/support.ts";
import { FEATURED, type ResolvedMedia, type Title } from "./titles.ts";

type Attempt = MediaVisibility["attempts"][number];
type Torrent = MediaVisibility["torrents"][number];
type Diagnostics = NonNullable<Torrent["diagnostics"]>;
type Playback = MediaVisibility["playback"];
type Progress = Pick<MediaVisibility, "attempts" | "torrents">;

export function assetId(item: MediaItem, ordinal = 1): string {
  return derivedId(6, item.id, ordinal);
}

function torrentId(item: MediaItem, ordinal: number): string {
  return derivedId(7, item.id, ordinal);
}

function attempt(
  item: MediaItem,
  ordinal: number,
  state: string,
  options: { age: number; torrent?: boolean; currentEpoch?: boolean },
): Attempt {
  return {
    id: derivedId(8, item.id, ordinal),
    state,
    torrentId: options.torrent === false ? null : torrentId(item, ordinal),
    createdAt: ago(options.age),
    currentEpoch: options.currentEpoch ?? true,
  };
}

function torrent(
  item: MediaItem,
  ordinal: number,
  overrides: Partial<Torrent>,
): Torrent {
  return {
    id: torrentId(item, ordinal),
    state: "downloading",
    observedAt: ago(2 * MINUTE),
    freshness: "fresh",
    progress: 0.5,
    ratio: { kind: "finite", value: 0.12 },
    seededSeconds: 0,
    diagnostics: null,
    ...overrides,
  };
}

const SECONDS_PER_DAY = 86_400;

function seedingDiagnostics(satisfied: boolean): Diagnostics {
  return {
    providerId: "privatehd",
    policy: {
      kind: "private",
      verified: true,
      ratio: 1,
      minimumSeconds: 3 * SECONDS_PER_DAY,
      combination: "any",
      sizeRule: {
        secondsPerGiB: 3600,
        minimumSeconds: 3 * SECONDS_PER_DAY,
        maximumSeconds: 14 * SECONDS_PER_DAY,
      },
    },
    protections: satisfied ? [] : ["source_in_use"],
    obligation: {
      satisfied,
      reason: satisfied ? "obligations_satisfied" : "seeding_required",
      requiredSeconds: 3 * SECONDS_PER_DAY,
    },
    cleanup: {
      status: satisfied ? "removable" : "seeding",
      reason: satisfied ? "obligations_satisfied" : "seeding_required",
      evaluatedAt: ago(11 * MINUTE),
      freshness: "current",
      phase: "evaluation",
    },
  };
}

/** An upgrade in flight over a seeded copy, with an attempt from an old epoch. */
function upgradingMovieProgress(item: MediaItem): Progress {
  return {
    attempts: [
      attempt(item, 3, "downloading", { age: 50 * MINUTE }),
      attempt(item, 2, "completed", { age: 40 * DAY }),
      attempt(item, 1, "obsolete", { age: 41 * DAY, currentEpoch: false }),
    ],
    torrents: [
      torrent(item, 3, {
        progress: 0.42,
        ratio: { kind: "finite", value: 0.03 },
        diagnostics: {
          providerId: "avistaz",
          policy: { kind: "privatehd", verified: true, ratio: 0.9 },
          protections: ["source_in_use"],
          obligation: {
            satisfied: false,
            reason: "download_incomplete",
            requiredSeconds: null,
          },
          cleanup: null,
        },
      }),
      torrent(item, 2, {
        state: "stoppedUP",
        progress: 1,
        ratio: { kind: "finite", value: 2.37 },
        seededSeconds: 40 * SECONDS_PER_DAY,
        diagnostics: seedingDiagnostics(true),
      }),
      torrent(item, 1, {
        state: "removed",
        observedAt: ago(41 * DAY),
        freshness: "old_epoch",
        progress: 1,
        ratio: { kind: "infinite" },
        seededSeconds: SECONDS_PER_DAY,
        diagnostics: {
          providerId: "knaben",
          policy: { kind: "public" },
          protections: ["old_epoch"],
          obligation: null,
          cleanup: {
            status: "removed",
            reason: null,
            evaluatedAt: ago(40 * DAY),
            freshness: "stale",
            phase: "removal",
          },
        },
      }),
    ],
  };
}

/** A season pack downloading beside a failed attempt and a stale observation. */
function airingSeriesProgress(item: MediaItem): Progress {
  return {
    attempts: [
      attempt(item, 4, "downloading", { age: 35 * MINUTE }),
      attempt(item, 3, "validating", { age: 3 * HOUR }),
      attempt(item, 2, "failed", { age: 9 * HOUR, torrent: false }),
      attempt(item, 1, "completed", { age: 12 * DAY }),
    ],
    torrents: [
      torrent(item, 4, {
        progress: 0.63,
        ratio: { kind: "finite", value: 0.08 },
        diagnostics: seedingDiagnostics(false),
      }),
      torrent(item, 3, {
        state: "stoppedUP",
        progress: 1,
        ratio: { kind: "finite", value: 0.41 },
        seededSeconds: 9900,
        diagnostics: seedingDiagnostics(false),
      }),
      torrent(item, 1, {
        state: "seeding",
        observedAt: ago(26 * HOUR),
        freshness: "stale",
        progress: 1,
        ratio: { kind: "finite", value: 1.84 },
        seededSeconds: 12 * SECONDS_PER_DAY,
        diagnostics: {
          providerId: "thepiratebay",
          policy: { kind: "unknown" },
          protections: ["stale_observation"],
          obligation: {
            satisfied: false,
            reason: "policy_required",
            requiredSeconds: null,
          },
          cleanup: null,
        },
      }),
    ],
  };
}

function finishedTorrent(
  item: MediaItem,
  ratio: number,
  seededSeconds: number,
): Torrent {
  return torrent(item, 1, {
    state: "stoppedUP",
    progress: 1,
    ratio: { kind: "finite", value: ratio },
    seededSeconds,
  });
}

/** The single attempt a title in an ordinary lifecycle state would show. */
function ordinaryProgress(item: MediaItem, persona: Persona): Progress {
  switch (item.availability) {
    case "downloading":
      return {
        attempts: [attempt(item, 1, "downloading", { age: 2 * HOUR })],
        torrents: [torrent(item, 1, { progress: 0.27 })],
      };
    case "validating":
      return {
        attempts: [attempt(item, 1, "validating", { age: 5 * HOUR })],
        torrents: [finishedTorrent(item, 0.2, 3600)],
      };
    case "importing":
      return {
        attempts: [attempt(item, 1, "imported", { age: 6 * HOUR })],
        torrents: [finishedTorrent(item, 0.6, 14_400)],
      };
    case "available":
    case "quarantined":
      return {
        attempts: [attempt(item, 1, "completed", { age: 30 * DAY })],
        torrents: [
          {
            ...finishedTorrent(item, 1.6, 30 * SECONDS_PER_DAY),
            // Seeding diagnostics are an owner-only projection.
            diagnostics: persona === "owner" ? seedingDiagnostics(true) : null,
          },
        ],
      };
    case "searching":
      return {
        attempts: [
          attempt(item, 1, "failed", { age: 3 * DAY, torrent: false }),
        ],
        torrents: [],
      };
    case "wanted":
    case "removed":
      return { attempts: [], torrents: [] };
  }
}

function progress(resolved: ResolvedMedia, persona: Persona): Progress {
  const { item, title } = resolved;
  if (title === FEATURED.movie) {
    return upgradingMovieProgress(item);
  }
  if (title === FEATURED.series && item.kind !== "episode") {
    return airingSeriesProgress(item);
  }
  if (title === FEATURED.searchingMovie) {
    return {
      attempts: [
        attempt(item, 2, "failed", { age: 2 * DAY, torrent: false }),
        attempt(item, 1, "cancelled", { age: 6 * DAY, torrent: false }),
      ],
      torrents: [],
    };
  }
  return ordinaryProgress(item, persona);
}

function playableChildren(resolved: ResolvedMedia, visible: number): number {
  const { item, title, children } = resolved;
  if (item.kind === "season") {
    return children.filter((child) => child.availability === "available")
      .length;
  }
  if (title === FEATURED.series) {
    return 15;
  }
  switch (item.availability) {
    case "available":
      return visible;
    case "wanted":
    case "searching":
    case "removed":
      return 0;
    case "downloading":
    case "validating":
    case "importing":
    case "quarantined":
      return Math.max(0, visible - 4);
  }
}

function episodeCount(title: Title): number {
  return title.seasons.reduce((sum, count) => sum + count, 0);
}

function collectionPlayback(resolved: ResolvedMedia): Playback {
  const { item, title, children } = resolved;
  const visible =
    item.kind === "series" ? episodeCount(title) : children.length;
  const ready = playableChildren(resolved, visible);
  // One episode of the featured series is present in Plex without a managed file.
  const unmanaged = title === FEATURED.series && item.kind === "series" ? 1 : 0;
  return {
    scope: "collection",
    playable: ready > 0,
    playableItems: ready,
    visibleItems: visible,
    ...(unmanaged > 0 ? { externalAvailableItems: unmanaged } : {}),
    association: {
      legacyUnverifiedItems: unmanaged,
      reconciliationRequiredItems: 0,
    },
    currentAssetId: null,
    currentVersion: null,
    upgradeInProgress: title === FEATURED.series,
  };
}

function titlePlayback(resolved: ResolvedMedia): Playback {
  const playable = resolved.item.availability === "available";
  return {
    scope: "title",
    playable,
    playableItems: playable ? 1 : 0,
    visibleItems: 1,
    association: { legacyUnverifiedItems: 0, reconciliationRequiredItems: 0 },
    currentAssetId: playable ? assetId(resolved.item) : null,
    currentVersion: playable ? 2 : null,
    upgradeInProgress: resolved.title === FEATURED.movie,
  };
}

/** What a viewer may see about playback and acquisition for one media item. */
export function mediaVisibility(
  resolved: ResolvedMedia,
  persona: Persona,
): MediaVisibility {
  const { item, title } = resolved;
  const collection = item.kind === "series" || item.kind === "season";
  return {
    movieRequests:
      item.kind === "movie"
        ? movieRequestsFor(title).map((request) => ({
            requestId: requestId(request.sequence),
            edition: request.edition,
            fulfillment: request.fulfillment,
          }))
        : [],
    playback: collection
      ? collectionPlayback(resolved)
      : titlePlayback(resolved),
    ...progress(resolved, persona),
    historyTruncated: title === FEATURED.movie,
  };
}
