import type { z } from "zod";
import type { NativeCompensationInventorySchema } from "#shared/native-recovery/compensation-runtime.ts";
import type { NativeArchiveInventorySchema } from "#shared/native-recovery/archive-view.ts";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import type { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import {
  DAY,
  HOUR,
  ago,
  ahead,
  fixtureId,
  sha256,
} from "#testing/fixture-api/support.ts";
import { titleNamed } from "./titles.ts";

type Inventory = z.input<typeof NativeRecoveryInventorySchema>;
type Detail = z.input<typeof NativeLifecycleDetailSchema>;
type Archives = z.input<typeof NativeArchiveInventorySchema>;
type Compensations = z.input<typeof NativeCompensationInventorySchema>;

/** A prepared file review in each state the page shows. */
export const NATIVE_REVIEW_IDS = {
  awaitingReview: fixtureId(33, 10),
  preparing: fixtureId(33, 11),
  applying: fixtureId(33, 12),
  applied: fixtureId(33, 13),
} as const;

const REVIEW_STATES = [
  [NATIVE_REVIEW_IDS.awaitingReview, "awaiting_review", 2],
  [NATIVE_REVIEW_IDS.preparing, "preparing", 3],
  [NATIVE_REVIEW_IDS.applying, "applying", 6],
  [NATIVE_REVIEW_IDS.applied, "applied", 9],
] as const;

const RUNTIME = { mode: "active", recoveryEpoch: 1, version: 12 } as const;

const ASSETS = [
  ["Dune", "published", []],
  ["The Godfather", "published", []],
  ["Heat", "quarantined", []],
  ["Blade Runner 2049", "published", ["plex_exclusion_missing"]],
  ["Parasite", "published", ["subtitle_ownership_unconfirmed"]],
] as const;

/**
 * What the recovery inventory knows: the runtime's mode and epoch, the restore
 * being reproved, the earlier-epoch files, and the reviews already prepared.
 */
export function nativeRecoveryInventory(
  options: { prerequisites?: readonly string[] } = {},
): Inventory {
  return {
    nextCursor: null,
    prerequisites: [...(options.prerequisites ?? [])],
    runtime: RUNTIME,
    restoreOperationId: fixtureId(33, 1),
    assets: ASSETS.map(([name, state, reasons], index) => ({
      id: fixtureId(33, 100 + index),
      version: 2,
      titles: [titleNamed(name).title],
      state,
      reasons: [...reasons],
    })),
    plans: REVIEW_STATES.map(([id, state, days]) => ({
      id,
      state,
      createdAt: ago(days * DAY),
    })),
  };
}

export function nativeArchiveInventory(): Archives {
  const cleanups = [
    ["Alien", []],
    ["Whiplash", []],
    ["Moonlight", ["archive_media_held"]],
    ["Past Lives", ["archive_prior_grant_required"]],
  ] as const;
  return {
    nextCursor: null,
    runtime: RUNTIME,
    restoreOperationId: fixtureId(33, 1),
    prerequisites: [],
    cleanups: cleanups.map(([name, reasons], index) => {
      const title = titleNamed(name);
      return {
        id: fixtureId(35, index + 1),
        version: 1,
        assetId: fixtureId(35, 100 + index),
        successorAssetId: fixtureId(35, 200 + index),
        titles: [title.title],
        mediaIds: [title.id],
        expiresAt: ahead((2 + index) * DAY),
        state: "pending",
        sizeBytes: String(9_400_000_000 + index),
        ownershipEpoch: 0,
        reasons: [...reasons],
      };
    }),
  };
}

export function nativeCompensationInventory(): Compensations {
  const upgrades = [
    ["Interstellar", null],
    ["Arrival", "publication_evidence_incomplete"],
  ] as const;
  return {
    nextCursor: null,
    items: upgrades.map(([name, protection], index) => {
      const title = titleNamed(name);
      return {
        transitionId: fixtureId(36, index + 1),
        attemptId: fixtureId(36, 100 + index),
        birthEpoch: 0,
        media: [{ id: title.id, title: title.title }],
        predecessors: [
          {
            assetId: fixtureId(36, 200 + index),
            path: `/data/movies/${title.title} (${String(title.year)})/${title.title}.mkv`,
          },
        ],
        successorAssetIds: [fixtureId(36, 300 + index)],
        selectable: protection === null,
        protection,
      };
    }),
  };
}

function summary(state: string, hours: number | null, receipt: boolean) {
  return {
    id: "",
    state,
    version: 4,
    plan: null,
    planHash: hours === null ? null : sha256(`native-plan:${state}`),
    expiresAt: hours === null ? null : ahead(hours * HOUR),
    receiptId: receipt ? fixtureId(33, 900) : null,
  };
}

function scope(): Detail["scope"] {
  const dune = titleNamed("Dune");
  const godfather = titleNamed("The Godfather");
  const file = (
    sequence: number,
    title: typeof dune,
    path: string,
    subtitles: number,
  ) => ({
    assetId: fixtureId(33, 100 + sequence),
    assetVersion: 2,
    canonicalPath: path,
    libraryKind: "movies" as const,
    checksum: sha256(`native-file:${path}`),
    sizeBytes: "9400000000",
    ownershipEpoch: 0,
    properties: {},
    mediaIds: [title.id],
    subtitles: Array.from({ length: subtitles }, (_, index) => ({
      id: fixtureId(33, 500 + sequence * 10 + index),
      assetId: fixtureId(33, 100 + sequence),
      version: 1,
      ownershipEpoch: 0,
      state: "installed" as const,
      qualityStatus:
        index === 0 ? ("accepted" as const) : ("unverified" as const),
      storageKind: "sidecar" as const,
      language: "en",
      providerId: "opensubtitles",
      path: `${path.replace(".mkv", "")}.en${index === 0 ? "" : ".hi"}.srt`,
      checksum: sha256(`native-subtitle:${path}:${String(index)}`),
      videoChecksum: sha256(`native-file:${path}`),
      videoVersion: 2,
      forced: false,
      hearingImpaired: index === 0 ? false : true,
      streamIndex: null,
      codec: null,
      provenance: {},
      matchingEvidence: {},
      contentChecksum: null,
    })),
  });
  const root = (rootPath: "/data/movies" | "/data/tv", sequence: number) => ({
    rootPath,
    pvcUid: `pvc-${String(sequence)}`,
    volumeName: `volume-${String(sequence)}`,
    volumePath: `/volumes/${String(sequence)}`,
    receipt: {
      kind: "native" as const,
      id: fixtureId(33, 800 + sequence),
      planHash: sha256(`root:${rootPath}`),
    },
  });
  const media = (title: typeof dune) => ({
    id: title.id,
    title: title.title,
    kind: "movie" as const,
    version: 3,
    tmdbId: title.tmdbId,
    externalIds: {},
    seasonNumber: null,
    episodeNumber: null,
    parent: null,
    intent: null,
    profile: null,
  });
  return {
    schemaVersion: 1,
    request: {
      restoreOperationId: fixtureId(33, 1),
      recoveryEpoch: RUNTIME.recoveryEpoch,
      runtimeVersion: RUNTIME.version,
      activation: "extend",
      assetIds: [fixtureId(33, 101), fixtureId(33, 102)],
    },
    media: [media(dune), media(godfather)],
    files: [
      file(1, dune, "/data/movies/Dune (2021)/Dune (2021) Bluray-1080p.mkv", 2),
      file(
        2,
        godfather,
        "/data/movies/The Godfather (1972)/The Godfather (1972) Bluray-1080p.mkv",
        0,
      ),
    ],
    storageRoots: [root("/data/movies", 1), root("/data/tv", 2)],
    subtitlePolicies: [
      {
        mediaId: dune.id,
        localPolicyId: null,
        localVersion: -1,
        effective: {
          id: fixtureId(33, 600),
          mediaId: dune.id,
          version: 2,
          recoveryEpoch: 0,
          source: {},
          rules: {
            schemaVersion: 1,
            targets: [
              {
                sourceItemId: 1,
                language: "en",
                audioLanguage: "en",
                forced: false,
                hearingImpaired: "any",
                audio: "any",
              },
            ],
            protectedReasons: ["generic_chinese_unresolved"],
          },
        },
      },
      {
        mediaId: godfather.id,
        localPolicyId: null,
        localVersion: -1,
        effective: null,
      },
    ],
    household: {},
    lifecycle: {},
    torrents: [],
  };
}

/** One prepared file review, by id. */
export function nativeRecoveryDetail(id: string): Detail | null {
  const found = REVIEW_STATES.find(([reviewId]) => reviewId === id);
  if (found === undefined) return null;
  const [, state] = found;
  const base = summary(
    state,
    state === "preparing" ? null : 20,
    state === "applied",
  );
  return {
    ...base,
    id,
    scope: scope(),
    continuations: [],
  };
}
