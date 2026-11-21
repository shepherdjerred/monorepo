import type { z } from "zod";
import type { Availability } from "#shared/contract.ts";
import type {
  MovieTargetAssetV4Schema,
  MovieTargetContextV4Schema,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MovieRollbackViewV1Schema } from "#shared/movie-editions/rollback/view.ts";
import type { MovieSubtitleTargetV2Schema } from "#shared/movie-editions/subtitle-target-v2.ts";
import type { SubtitlePolicySatisfactionSchema } from "#shared/subtitle-policy.ts";
import {
  choiceId,
  editionLabel,
  movieRequestsFor,
  movieScope,
  requestVersion,
} from "./movie-requests.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { requestId } from "./requests.ts";
import { DAY, ago, fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import { FEATURED, type ResolvedMedia } from "./titles.ts";
import { assetId, mediaVisibility } from "./visibility.ts";

type MovieTarget = z.input<typeof MovieTargetContextV4Schema>;
type MovieTargetDetail = Extract<MovieTarget, { access: "detail" }>;
type MovieTargetAsset = z.input<typeof MovieTargetAssetV4Schema>;
type SubtitleTarget = z.input<typeof MovieSubtitleTargetV2Schema>;
type Rollback = z.input<typeof MovieRollbackViewV1Schema>;
type SubtitleStatus = z.input<typeof SubtitlePolicySatisfactionSchema>;

/** The household's Simplified Chinese caption requirement. */
export const CHINESE_CAPTIONS = {
  sourceItemId: 12,
  language: "zh-Hans",
  audioLanguage: "en",
  forced: false,
  hearingImpaired: "any",
  audio: "any",
} as const;

export const CAPTIONS_SATISFIED: SubtitleStatus = {
  satisfied: true,
  missing: [],
  householdMissing: [],
  protectedReasons: [],
};
export const CAPTIONS_MISSING: SubtitleStatus = {
  satisfied: false,
  missing: [CHINESE_CAPTIONS],
  householdMissing: [],
  protectedReasons: ["subtitle_cutoff_requires_resolution"],
};

const REMUX_BYTES = 71_342_556_160;
const WEB_BYTES = 8_214_663_168;
const PREDECESSOR_BYTES = 9_874_112_512;

function currentAsset(resolved: ResolvedMedia): MovieTargetAsset {
  const rich = resolved.title === FEATURED.movie;
  return {
    id: assetId(resolved.item),
    version: 2,
    state: "published",
    properties: {
      quality: rich ? "Remux-2160p" : "WEBDL-1080p",
      codec: rich ? "hevc" : "h264",
      sizeBytes: rich ? REMUX_BYTES : WEB_BYTES,
      audioLanguages: rich ? ["en", "fr"] : ["en"],
      hdr: rich,
    },
    captions: [
      {
        id: fixtureId(9, 5001),
        language: "en",
        state: "installed",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        accepted: true,
        forced: false,
        hearingImpaired: true,
      },
      {
        id: fixtureId(9, 5002),
        language: "en",
        state: "installed",
        qualityStatus: "accepted",
        storageKind: "embedded",
        accepted: true,
        forced: true,
        hearingImpaired: false,
      },
      ...(rich
        ? [
            {
              id: fixtureId(9, 5003),
              language: "zh-Hans",
              state: "quarantined" as const,
              qualityStatus: "rejected",
              storageKind: "sidecar",
              accepted: false,
              forced: false,
              hearingImpaired: null,
            },
          ]
        : []),
    ],
    captionsTruncated: false,
    subtitleStatus: rich ? CAPTIONS_MISSING : CAPTIONS_SATISFIED,
  };
}

function allowedActions(
  persona: Persona,
  availability: Availability,
): MovieTargetDetail["allowedActions"] {
  if (persona !== "owner") {
    return ["keep"];
  }
  if (availability === "available") {
    return ["keep", "pin", "unpin", "remove", "select_release"];
  }
  return availability === "quarantined"
    ? ["keep", "restore"]
    : ["keep", "pin", "retry", "select_release"];
}

function admissionReasons(
  resolved: ResolvedMedia,
  edition: MovieEditionKey,
  hasFile: boolean,
): MovieTargetDetail["reasons"] {
  if (hasFile) {
    return resolved.title === FEATURED.movie ? ["acquisition_active"] : [];
  }
  return edition === "default"
    ? ["asset_unavailable"]
    : ["choice_activation_required", "asset_unavailable"];
}

/** The controls for one cut of a movie; only the unmarked cut has a file. */
export function movieTarget(
  resolved: ResolvedMedia,
  edition: MovieEditionKey,
  persona: Persona,
): MovieTarget {
  const { item, title } = resolved;
  const unmarked = edition === "default";
  const availability: Availability = unmarked ? item.availability : "wanted";
  const hasFile = availability === "available";
  const owner = persona === "owner";
  const asset = hasFile ? currentAsset(resolved) : null;
  const visibility = mediaVisibility(resolved, persona);
  return {
    schemaVersion: 4,
    scope: movieScope(title, edition),
    expected: { mediaVersion: item.version, targetVersion: 2 },
    ownRequests: movieRequestsFor(title)
      .filter((request) => request.edition === edition)
      .map((request) => ({
        id: requestId(request.sequence),
        version: requestVersion(request),
        active: request.active,
        choiceId: choiceId(request),
        choiceRevision: request.chosen ? 1 : 0,
        canCancel: request.active,
        canRevokeChoice: false,
      })),
    ownHold:
      owner && unmarked && title === FEATURED.movie
        ? { isPin: true, until: null }
        : null,
    allowedProtectiveActions: owner
      ? ["keep", "pin", "unpin", "cancel_request"]
      : ["keep", "cancel_request"],
    access: "detail",
    title: title.title,
    year: title.year,
    editionLabel: editionLabel(edition),
    target: {
      generation: 3,
      availability,
      desiredPresence: availability !== "removed",
      monitoring: unmarked,
      libraryMonitoring: unmarked && title.index % 2 === 0,
    },
    allowedActions: allowedActions(persona, availability),
    reasons: admissionReasons(resolved, edition, hasFile),
    removalConfirmation:
      asset !== null && owner
        ? {
            scope: movieScope(title, edition),
            fileSetHash: sha256(`fileset:${item.id}`),
            assets: [
              {
                assetId: asset.id,
                assetVersion: asset.version,
                checksum: sha256(`asset:${asset.id}`),
              },
            ],
          }
        : null,
    currentAsset: asset,
    progress: unmarked
      ? {
          attempts: visibility.attempts,
          torrents: visibility.torrents,
          historyTruncated: visibility.historyTruncated,
        }
      : null,
  };
}

/** The current file and captions an owner can replace for one cut. */
export function movieSubtitleTarget(
  resolved: ResolvedMedia,
  edition: MovieEditionKey,
): SubtitleTarget {
  const { item, title } = resolved;
  const asset = assetId(item);
  return {
    assetId: asset,
    version: 2,
    checksum: sha256(`asset:${asset}`),
    filename: `${title.title.replaceAll(":", "")} (${String(title.year)}) [Remux-2160p].mkv`,
    titles: [title.title],
    installedLanguages: ["en"],
    subtitles: [
      {
        id: fixtureId(9, 5001),
        version: 1,
        state: "installed",
        qualityStatus: "accepted",
        language: "en",
        forced: false,
        hearingImpaired: true,
        providerId: "opensubtitles",
        filename: `${title.title}.en.hi.srt`,
        storageKind: "sidecar",
      },
      {
        id: fixtureId(9, 5003),
        version: 1,
        state: "validated",
        qualityStatus: "rejected",
        language: "zh-Hans",
        forced: false,
        hearingImpaired: null,
        providerId: "assrt",
        filename: null,
        storageKind: "sidecar",
      },
    ],
    schemaVersion: 2,
    scope: movieScope(title, edition),
    editionLabel: editionLabel(edition),
  };
}

/** An upgrade whose rollback window has closed, or no upgrade at all. */
export function movieRollback(
  resolved: ResolvedMedia,
  edition: MovieEditionKey,
): Rollback {
  const { item, title } = resolved;
  const upgraded = item.availability === "available" && edition === "default";
  return {
    scope: movieScope(title, edition),
    title: title.title,
    editionLabel: editionLabel(edition),
    predecessor: upgraded
      ? {
          id: assetId(item, 2),
          version: 3,
          quality: "WEBDL-1080p",
          codec: "h264",
          audioLanguages: ["en"],
          sizeBytes: String(PREDECESSOR_BYTES),
        }
      : null,
    successor: upgraded
      ? {
          id: assetId(item),
          version: 2,
          quality: "Remux-2160p",
          codec: "hevc",
          audioLanguages: ["en", "fr"],
          sizeBytes: String(REMUX_BYTES),
        }
      : null,
    originalDeadline: upgraded ? ago(26 * DAY) : null,
    state: "unavailable",
    reason: upgraded ? "rollback_window_closed" : "no_current_movie",
    command: null,
  };
}
