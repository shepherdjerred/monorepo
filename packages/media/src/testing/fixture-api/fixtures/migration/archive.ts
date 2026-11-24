import type { z } from "zod";
import type { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";
import { DAY, ahead, fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import {
  RESTORE_OPERATION_ID,
  RUNTIME,
  emptyHousehold,
  reviewFrame,
  scopeMedia,
  storageRoots,
  subtitleOf,
  type Detail,
  type ReviewState,
} from "./parts.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

type Scope = z.input<typeof NativeArchiveScopeSchema>;

/** A review of upgrade archives whose expiry cleanup should resume. */
export const ARCHIVE_REVIEW_IDS = {
  awaitingReview: fixtureId(38, 1),
  preparing: fixtureId(38, 2),
  applied: fixtureId(38, 3),
} as const;

const PATHS = {
  old: "/data/movies/Alien (1979)/Alien (1979) Bluray-1080p.mkv",
  current: "/data/movies/Alien (1979)/Alien (1979) Remux-2160p.mkv",
} as const;

function scope(withSupersession: boolean): Scope {
  const alien = titleNamed("Alien");
  const oldAsset = fixtureId(38, 100);
  const currentAsset = fixtureId(38, 101);
  const file = (
    assetId: string,
    path: string,
    role: "selected_archive" | "current_playback",
    subtitles: number,
  ) => {
    const checksum = sha256(`archive-file:${path}`);
    return {
      assetId,
      assetVersion: 2,
      canonicalPath: path,
      libraryKind: "movies" as const,
      checksum,
      sizeBytes: role === "selected_archive" ? "9400000000" : "21000000000",
      ownershipEpoch: 0,
      properties: {},
      mediaIds: [alien.id],
      role,
      state:
        role === "selected_archive"
          ? ("superseded" as const)
          : ("published" as const),
      edition: "default" as const,
      editionRootId: alien.id,
      sourcePath: null,
      supersededByAssetId: role === "selected_archive" ? currentAsset : null,
      plexPublishedAt: null,
      rollbackExpiresAt: null,
      coverage: [
        { mediaId: alien.id, edition: "default" as const, current: true },
      ],
      subtitles: Array.from({ length: subtitles }, (_, index) => ({
        ...subtitleOf({
          id: fixtureId(38, 300 + index),
          assetId,
          path: path.replace(".mkv", ".en.srt"),
          checksum: sha256(`archive-subtitle:${path}`),
          videoChecksum: checksum,
          quality: "accepted",
          hearingImpaired: false,
        }),
        state: "installed" as const,
      })),
      authority:
        role === "selected_archive"
          ? ({ kind: "rebaseline" } as const)
          : ({
              kind: "prior_native_binding",
              receiptLifecycle: "published",
              receiptId: fixtureId(38, 700),
              planHash: sha256("archive-prior-plan"),
              assetId,
              bindingHash: sha256("archive-binding"),
              physicalEvidenceHash: sha256("archive-physical"),
            } as const),
    };
  };
  return {
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    request: {
      restoreOperationId: RESTORE_OPERATION_ID,
      recoveryEpoch: RUNTIME.recoveryEpoch,
      runtimeVersion: RUNTIME.version,
      activation: "extend",
      cleanupIds: [fixtureId(38, 400)],
    },
    media: [scopeMedia(alien)],
    files: [
      file(oldAsset, PATHS.old, "selected_archive", 1),
      file(currentAsset, PATHS.current, "current_playback", 0),
    ],
    edges: [
      {
        id: fixtureId(38, 400),
        assetId: oldAsset,
        successorAssetId: currentAsset,
        recoveryEpoch: 0,
        expiresAt: ahead(3 * DAY),
        state: "pending",
        version: 2,
        createdAt: ahead(-9 * DAY),
        updatedAt: ahead(-4 * DAY),
        manifest: null,
        manifestHash: null,
        derivedPlan: {
          libraryKind: "movies",
          assetVersion: 2,
          successorChecksum: sha256(`archive-file:${PATHS.current}`),
          mediaIds: [alien.id],
          files: [
            {
              location: "rollback",
              id: "rollback-1",
              path: PATHS.old,
              checksum: sha256(`archive-file:${PATHS.old}`),
              subtitleId: null,
            },
          ],
        },
        selected: true,
        publicationAttempt: {
          id: fixtureId(38, 500),
          operationId: fixtureId(38, 501),
          recoveryEpoch: 0,
          state: "completed",
          filePlanHash: sha256("archive-file-plan"),
          entry: {
            assetId: currentAsset,
            mediaIds: [alien.id],
            generations: {},
            libraryKind: "movies",
            downloadPath: "/downloads/alien.mkv",
            libraryPath: PATHS.current,
            checksum: sha256(`archive-file:${PATHS.current}`),
            sizeBytes: "21000000000",
            properties: {},
            operationId: "publish-1",
            previousAssetId: oldAsset,
            previousChecksum: sha256(`archive-file:${PATHS.old}`),
            previousVersion: 2,
            previousSidecars: [],
            embeddedSubtitles: [],
          },
        },
        successorPublishedAt: ahead(-9 * DAY),
      },
    ],
    terminalDependencies: [],
    currentPlayback: [{ assetId: currentAsset, mediaIds: [alien.id] }],
    ...(withSupersession
      ? {
          supersessions: [
            {
              continuationId: fixtureId(38, 800),
              receiptId: fixtureId(38, 801),
              originalCleanupId: fixtureId(38, 400),
              version: 2,
              descriptorHash: sha256("archive-descriptor"),
              coordinatorOperationId: fixtureId(38, 802),
              executionHash: null,
            },
          ],
        }
      : {}),
    storageRoots: storageRoots(),
    subtitlePolicies: [
      {
        mediaId: alien.id,
        localPolicyId: null,
        localVersion: -1,
        effective: null,
      },
    ],
    ...emptyHousehold(),
  };
}

/** Where cleanup of the selected archive stands after approval. */
function archiveContinuations(
  state: ReviewState,
): Detail["archiveContinuations"] {
  if (state === "awaiting_review" || state === "preparing") return undefined;
  const base = {
    originalCleanupId: fixtureId(38, 400),
    version: 3,
    expiresAt: ahead(3 * DAY),
    titles: ["Alien"],
  };
  return state === "applying"
    ? [{ ...base, id: fixtureId(38, 900), state: "pending", reasons: [] }]
    : [
        {
          ...base,
          id: fixtureId(38, 901),
          state: "protected",
          reasons: ["archive_media_held"],
        },
        {
          ...base,
          id: fixtureId(38, 902),
          state: "superseded",
          reasons: [],
        },
      ];
}

/** One archive cleanup review, by id. */
export function archiveReviewDetail(id: string): Detail | null {
  const found = Object.entries({
    [ARCHIVE_REVIEW_IDS.awaitingReview]: "awaiting_review",
    [ARCHIVE_REVIEW_IDS.preparing]: "preparing",
    [ARCHIVE_REVIEW_IDS.applied]: "applied",
  } as const).find(([reviewId]) => reviewId === id);
  if (found === undefined) return null;
  const state = found[1];
  const continuations = archiveContinuations(state);
  return {
    ...reviewFrame(id, state, `archive:${state}`),
    scope: scope(state === "applied"),
    continuations: [],
    ...(continuations === undefined
      ? {}
      : { archiveContinuations: continuations }),
  };
}
