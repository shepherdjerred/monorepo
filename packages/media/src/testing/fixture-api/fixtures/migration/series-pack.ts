import type { z } from "zod";
import type { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import type { NativeRecoveryDetailProtocolSchema } from "#shared/native-recovery/series-pack/detail.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import {
  RESTORE_OPERATION_ID,
  RUNTIME,
  emptyHousehold,
  publicationEntry,
  reviewFrame,
  storageRoots,
  type ReviewState,
} from "./parts.ts";
import { episodeId, titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

type Protocol = z.input<typeof NativeRecoveryDetailProtocolSchema>;
type Scope = z.input<typeof SeriesPackNativeCompensationScopeV3Schema>;
type SeriesDetail = Extract<Protocol, { protocol: string }>;

/** A review of a TV season pack whose publication stopped part-way. */
export const SERIES_PACK_REVIEW_IDS = {
  awaitingReview: fixtureId(40, 1),
  preparing: fixtureId(40, 2),
  applying: fixtureId(40, 4),
  applied: fixtureId(40, 3),
} as const;

const TRANSITION_ID = fixtureId(40, 50);
const INTENT_HASH = sha256("series-pack-intent");
const EPISODES = 6;

function scope(): Scope {
  const series = titleNamed("The Bear");
  const rows = Array.from({ length: EPISODES }, (_, index) => {
    const label = `S01E${String(index + 1).padStart(2, "0")}`;
    return publicationEntry({
      namespace: 40,
      index,
      mediaId: episodeId(series, 1, index + 1),
      libraryKind: "tv",
      oldPath: `/data/tv/The Bear/Season 01/The Bear - ${label} - WEBDL-1080p.mkv`,
      newPath: `/data/tv/The Bear/Season 01/The Bear - ${label} - Bluray-2160p.mkv`,
      oldQuality: index === 0 ? "accepted" : "unverified",
    });
  });
  const attemptId = fixtureId(40, 60);
  const filePlanHash = sha256("series-pack-file-plan");
  return {
    schemaVersion: 3,
    lifecycleKind: "publication_compensation",
    protocol: "series_pack_publication_v3",
    request: {
      lifecycleKind: "publication_compensation",
      restoreOperationId: RESTORE_OPERATION_ID,
      recoveryEpoch: RUNTIME.recoveryEpoch,
      runtimeVersion: RUNTIME.version,
      activation: "extend",
      transitionId: TRANSITION_ID,
    },
    transition: {
      transitionId: TRANSITION_ID,
      intentHash: INTENT_HASH,
      attemptId,
      birthEpoch: 0,
      filePlanHash,
    },
    publication: {
      transitionId: TRANSITION_ID,
      intentHash: INTENT_HASH,
      intent: {
        schemaVersion: 3,
        transitionId: TRANSITION_ID,
        attemptId,
        operationId: fixtureId(40, 61),
        birthEpoch: 0,
        filePlanHash,
        attemptSnapshotHash: sha256("series-pack-attempt"),
        mediaIds: rows.map((row) => row.entry.mediaIds[0] ?? ""),
        entries: rows,
        seriesPackPublication: {
          schemaVersion: 1,
          coordinatorOperationId: fixtureId(40, 62),
          stagingSeal: {
            operationId: fixtureId(40, 63),
            sealHash: sha256("series-pack-seal"),
          },
          preparations: Array.from(
            { length: Math.ceil(EPISODES / 4) },
            (_, index) => ({
              operationId: fixtureId(40, 70 + index),
              batchIndex: index,
              preparedHash: sha256(`series-pack-prepared:${String(index)}`),
            }),
          ),
        },
      },
    },
    interruptedWork: {
      transitionId: TRANSITION_ID,
      intentHash: INTENT_HASH,
      attemptId,
      birthEpoch: 0,
      filePlanHash,
      attemptSnapshotHash: sha256("series-pack-attempt"),
      reservations: [],
      reservationSetHash: sha256("series-pack-reservations"),
    },
    interruptedAttemptRaw: "{}",
    forwardParents: [],
    previousCompensation: null,
    requiredAbsences: [],
    media: rows.map((row, index) => ({
      id: row.entry.mediaIds[0] ?? "",
      title: `${series.title} S01E${String(index + 1).padStart(2, "0")}`,
      kind: "episode" as const,
      version: 3,
      tmdbId: null,
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: index + 1,
      parent: null,
      intent: null,
      profile: null,
    })),
    files: rows.map((row) => ({
      assetId: row.predecessor.id,
      assetVersion: 2,
      canonicalPath: row.predecessor.path,
      libraryKind: "tv" as const,
      checksum: row.predecessor.checksum,
      sizeBytes: "9400000000",
      ownershipEpoch: 0,
      properties: {},
      mediaIds: row.entry.mediaIds,
      subtitles: row.predecessor.subtitles.map((subtitle) => ({
        ...subtitle,
        state: "installed" as const,
      })),
    })),
    storageRoots: storageRoots(),
    ...emptyHousehold(),
  };
}

function continuations(
  state: ReviewState,
): SeriesDetail["compensationContinuations"] {
  if (state === "awaiting_review" || state === "preparing") return [];
  const series = titleNamed("The Bear");
  return [
    {
      id: fixtureId(40, 900),
      transitionId: TRANSITION_ID,
      version: 2,
      state: state === "applying" ? "compensating" : "compensated",
      publicationState: state === "applying" ? "publishing" : "available",
      fenceActive: state === "applying",
      protectedReason: null,
      currentPositiveMediaIds: [episodeId(series, 1, 1)],
      media: [
        {
          id: episodeId(series, 1, 1),
          title: `${series.title} S01E01`,
          availability: state === "applying" ? "importing" : "available",
        },
      ],
    },
  ];
}

/** One season pack restoration review, by id. */
export function seriesPackReviewDetail(id: string): Protocol | null {
  const found = Object.entries({
    [SERIES_PACK_REVIEW_IDS.awaitingReview]: "awaiting_review",
    [SERIES_PACK_REVIEW_IDS.preparing]: "preparing",
    [SERIES_PACK_REVIEW_IDS.applying]: "applying",
    [SERIES_PACK_REVIEW_IDS.applied]: "applied",
  } as const).find(([reviewId]) => reviewId === id);
  if (found === undefined) return null;
  const state = found[1];
  const frame = reviewFrame(id, state, `series-pack:${state}`);
  return {
    id,
    state,
    version: frame.version,
    planHash: frame.planHash,
    expiresAt: frame.expiresAt,
    receiptId: frame.receiptId,
    schemaVersion: 1,
    protocol: "series_pack_native_compensation_v1",
    scope: scope(),
    plan: null,
    continuations: [],
    compensationContinuations: continuations(state),
  };
}
