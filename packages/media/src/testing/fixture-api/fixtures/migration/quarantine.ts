import type { z } from "zod";
import type { NativeQuarantineScopeSchema } from "#shared/native-recovery/quarantine.ts";
import { ago, fixtureId, sha256 } from "#testing/fixture-api/support.ts";
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

type Scope = z.input<typeof NativeQuarantineScopeSchema>;

/** A review of files that were in quarantine when the backup was taken. */
export const QUARANTINE_REVIEW_IDS = {
  awaitingReview: fixtureId(37, 1),
  preparing: fixtureId(37, 2),
  applied: fixtureId(37, 3),
} as const;

const FILES = [
  ["Heat", "/data/movies/Heat (1995)/Heat (1995) Bluray-1080p.mkv", 1],
  [
    "Moonlight",
    "/data/movies/Moonlight (2016)/Moonlight (2016) Bluray-1080p.mkv",
    0,
  ],
] as const;

function scope(): Scope {
  const titles = FILES.map(([name]) => titleNamed(name));
  const files = FILES.map(([, path, subtitles], index) => {
    const assetId = fixtureId(37, 100 + index);
    const checksum = sha256(`quarantine-file:${path}`);
    return {
      assetId,
      assetVersion: 2,
      canonicalPath: path,
      libraryKind: "movies" as const,
      checksum,
      sizeBytes: "9400000000",
      ownershipEpoch: 0,
      properties: {},
      mediaIds: [titles[index]?.id ?? ""],
      groupHash: sha256(`quarantine-group:${String(index)}`),
      quarantineId: fixtureId(37, 200 + index),
      libraryPath: path,
      subtitles: Array.from({ length: subtitles }, (_, position) => ({
        ...subtitleOf({
          id: fixtureId(37, 300 + position),
          assetId,
          path: path.replace(".mkv", ".en.srt"),
          checksum: sha256(`quarantine-subtitle:${path}`),
          videoChecksum: checksum,
          quality: "accepted",
          hearingImpaired: false,
        }),
        state: "quarantined" as const,
      })),
      sidecars: [],
    };
  });
  return {
    schemaVersion: 2,
    lifecycleKind: "committed_quarantine",
    request: {
      lifecycleKind: "committed_quarantine",
      restoreOperationId: RESTORE_OPERATION_ID,
      recoveryEpoch: RUNTIME.recoveryEpoch,
      runtimeVersion: RUNTIME.version,
      activation: "extend",
      assetIds: files.map((file) => file.assetId),
    },
    media: titles.map((title) => scopeMedia(title)),
    files,
    groups: files.map((file, index) => ({
      groupHash: file.groupHash,
      mediaIds: file.mediaIds,
      assetIds: [file.assetId],
      decisions: [
        {
          id: fixtureId(37, 400 + index),
          mediaId: file.mediaIds[0] ?? "",
          version: 1,
          generation: 1,
          recoveryEpoch: 0,
          manifest: {},
          manifestHash: sha256(`quarantine-manifest:${String(index)}`),
          evidence: {},
          quarantinedAt: ago(30 * 24 * 3_600_000),
          purgeAfter: ago(-5 * 24 * 3_600_000),
        },
      ],
    })),
    storageRoots: storageRoots(),
    subtitlePolicies: titles.map((title, index) => ({
      mediaId: title.id,
      localPolicyId: null,
      localVersion: -1,
      effective:
        index === 0
          ? {
              id: fixtureId(37, 500),
              mediaId: title.id,
              version: 2,
              recoveryEpoch: 0,
              source: {},
              rules: {
                schemaVersion: 1 as const,
                targets: [
                  {
                    sourceItemId: 1,
                    language: "en" as const,
                    audioLanguage: "en",
                    forced: false,
                    hearingImpaired: "any" as const,
                    audio: "any" as const,
                  },
                ],
                protectedReasons: [],
              },
            }
          : null,
    })),
    ...emptyHousehold(),
  };
}

/** What restoring each quarantined group stands at: waiting, restoring, or protected. */
function continuations(state: ReviewState): Detail["continuations"] {
  const [heat, moonlight] = FILES.map(([name]) => titleNamed(name));
  if (heat === undefined || moonlight === undefined) return [];
  if (state === "awaiting_review" || state === "preparing") return [];
  const restoring = state === "applying";
  return [
    {
      id: fixtureId(37, 600),
      groupHash: sha256("quarantine-group:0"),
      state: restoring ? "restoring" : "restored",
      version: 2,
      currentPositiveMediaIds: [heat.id],
      media: [
        {
          id: heat.id,
          title: heat.title,
          availability: restoring ? "importing" : "available",
        },
      ],
    },
    {
      id: fixtureId(37, 601),
      groupHash: sha256("quarantine-group:1"),
      state: "pending",
      version: 1,
      currentPositiveMediaIds: [],
      media: [
        {
          id: moonlight.id,
          title: moonlight.title,
          availability: "quarantined",
        },
      ],
    },
  ];
}

/** One quarantine file review, by id. */
export function quarantineReviewDetail(id: string): Detail | null {
  const found = Object.entries({
    [QUARANTINE_REVIEW_IDS.awaitingReview]: "awaiting_review",
    [QUARANTINE_REVIEW_IDS.preparing]: "preparing",
    [QUARANTINE_REVIEW_IDS.applied]: "applied",
  } as const).find(([reviewId]) => reviewId === id);
  if (found === undefined) return null;
  const state = found[1];
  return {
    ...reviewFrame(id, state, `quarantine:${state}`),
    scope: scope(),
    continuations: continuations(state),
  };
}
