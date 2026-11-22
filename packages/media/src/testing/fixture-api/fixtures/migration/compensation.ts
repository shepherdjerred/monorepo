import type { z } from "zod";
import type {
  FinishedNativeCompensationSchema,
  NativeCompensationScopeSchema,
} from "#shared/native-recovery/compensation.ts";
import type { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import {
  RESTORE_OPERATION_ID,
  RUNTIME,
  emptyHousehold,
  publicationEntry,
  reviewFrame,
  scopeMedia,
  storageRoots,
  type Detail,
  type ReviewState,
} from "./parts.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

type Scope = z.input<typeof NativeCompensationScopeSchema>;
type Plan = z.input<typeof FinishedNativeCompensationSchema>;
type Continuation = z.input<typeof NativeCompensationContinuationViewSchema>;
type Entry = Scope["entries"][number];

/** A review of an upgrade that stopped part-way, to restore its predecessor files. */
export const COMPENSATION_REVIEW_IDS = {
  awaitingReview: fixtureId(39, 1),
  preparing: fixtureId(39, 2),
  applying: fixtureId(39, 4),
  applied: fixtureId(39, 3),
} as const;

const TRANSITION_ID = fixtureId(39, 50);
const INTENT_HASH = sha256("compensation-intent");
const MOVIES = ["Interstellar", "Knives Out"] as const;

function entries(): Entry[] {
  return MOVIES.map((name, index) => {
    const title = titleNamed(name);
    const folder = `${name} (${String(title.year)})`;
    return publicationEntry({
      namespace: 39,
      index,
      mediaId: title.id,
      libraryKind: "movies",
      oldPath: `/data/movies/${folder}/${folder} Bluray-1080p.mkv`,
      newPath: `/data/movies/${folder}/${folder} Remux-2160p.mkv`,
      oldQuality: index === 0 ? "accepted" : "unverified",
    });
  });
}

function scope(): Scope {
  const titles = MOVIES.map((name) => titleNamed(name));
  const rows = entries();
  const attemptId = fixtureId(39, 60);
  return {
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
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
      filePlanHash: sha256("compensation-file-plan"),
    },
    intent: {
      schemaVersion: 1,
      transitionId: TRANSITION_ID,
      attemptId,
      operationId: fixtureId(39, 61),
      birthEpoch: 0,
      filePlanHash: sha256("compensation-file-plan"),
      attemptSnapshotHash: sha256("compensation-attempt"),
      mediaIds: titles.map((title) => title.id),
      entries: rows,
    },
    interruptedWork: {
      transitionId: TRANSITION_ID,
      intentHash: INTENT_HASH,
      attemptId,
      birthEpoch: 0,
      filePlanHash: sha256("compensation-file-plan"),
      attemptSnapshotHash: sha256("compensation-attempt"),
      reservations: [],
      reservationSetHash: sha256("compensation-reservations"),
    },
    entries: rows,
    previousCompensation: null,
    requiredAbsences: [],
    media: titles.map((title) => scopeMedia(title)),
    files: rows.map((row, index) => ({
      assetId: row.predecessor?.id ?? "",
      assetVersion: 2,
      canonicalPath: row.predecessor?.path ?? "",
      libraryKind: "movies" as const,
      checksum: row.predecessor?.checksum ?? "",
      sizeBytes: "9400000000",
      ownershipEpoch: 0,
      properties: {},
      mediaIds: [titles[index]?.id ?? ""],
      subtitles: [],
    })),
    storageRoots: storageRoots(),
    ...emptyHousehold(),
  };
}

function plan(): Plan {
  const rows = entries();
  return {
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    scopeHash: sha256("compensation-scope"),
    network: { identityHash: sha256("compensation-network") },
    files: {
      schemaVersion: 2,
      lifecycleKind: "publication_compensation",
      planId: fixtureId(39, 70),
      recoveryEpoch: RUNTIME.recoveryEpoch,
      transitionId: TRANSITION_ID,
      intentHash: INTENT_HASH,
      acknowledgedEffects: [],
      effectPrefixHash: sha256("compensation-effects"),
      participants: rows.flatMap((row) => row.participants),
      steps: rows.map((row, index) => ({
        stepId: `step-${String(index + 1)}`,
        entryOperationId: row.entry.operationId,
        kind: "rollback_video" as const,
        operationId: `rollback-${String(index + 1)}`,
        assetId: row.predecessor?.id ?? "",
        subtitleId: null,
        libraryKind: "movies" as const,
        sourcePath: row.entry.libraryPath,
        targetPath: row.predecessor?.path ?? null,
        checksum: row.entry.checksum,
        previousChecksum: row.predecessor?.checksum ?? null,
        retainedSuccessorPath: `/data/control/retained/${String(index + 1)}.mkv`,
      })),
      journalDigests: [
        { libraryKind: "movies", digest: sha256("compensation-journal") },
      ],
    },
  };
}

/** Where restoring the earlier files and their playback stands after approval. */
function continuations(state: ReviewState): Continuation[] {
  if (state === "awaiting_review" || state === "preparing") return [];
  const titles = MOVIES.map((name) => titleNamed(name));
  const media = titles.map((title) => ({
    id: title.id,
    title: title.title,
    availability: state === "applied" ? "available" : "unavailable",
  }));
  return state === "applying"
    ? [
        {
          id: fixtureId(39, 900),
          transitionId: TRANSITION_ID,
          version: 2,
          state: "compensating",
          publicationState: "held",
          fenceActive: true,
          protectedReason: null,
          currentPositiveMediaIds: titles.map((title) => title.id),
          media,
        },
      ]
    : [
        {
          id: fixtureId(39, 901),
          transitionId: TRANSITION_ID,
          version: 3,
          state: "compensated",
          publicationState: "available",
          fenceActive: false,
          protectedReason: null,
          currentPositiveMediaIds: titles.map((title) => title.id),
          media,
        },
      ];
}

/** One interrupted-upgrade restoration review, by id. */
export function compensationReviewDetail(id: string): Detail | null {
  const found = Object.entries({
    [COMPENSATION_REVIEW_IDS.awaitingReview]: "awaiting_review",
    [COMPENSATION_REVIEW_IDS.preparing]: "preparing",
    [COMPENSATION_REVIEW_IDS.applying]: "applying",
    [COMPENSATION_REVIEW_IDS.applied]: "applied",
  } as const).find(([reviewId]) => reviewId === id);
  if (found === undefined) return null;
  const state = found[1];
  return {
    ...reviewFrame(id, state, `compensation:${state}`),
    plan: state === "preparing" ? null : plan(),
    scope: scope(),
    continuations: [],
    compensationContinuations: continuations(state),
  };
}
