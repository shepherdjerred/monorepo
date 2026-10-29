import { z } from "zod";
import {
  NativeRecoveryNetworkEvidenceSchema,
  NativeRecoveryFileEvidenceSchema,
} from "#shared/native-recovery.ts";
import { NativePublishedFileEvidenceV2Schema } from "#shared/native-recovery/lifecycle.ts";
import {
  NativeQuarantineNetworkEvidenceSchema,
  NativeQuarantineFileEvidenceSchema,
} from "#shared/native-recovery/quarantine.ts";
import {
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveFileEvidenceSchema,
} from "#shared/native-recovery/archive.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import {
  NativeCompensationFileEvidenceSchema,
  NativeCompensationNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";

/** Literal historical projection shared by both legacy and Plex-bound native receipts. */
export function stableCompensationFiles(raw: unknown) {
  const {
    capturedAt: _capturedAt,
    workerPodUid: _worker,
    ...files
  } = NativeCompensationFileEvidenceSchema.parse(raw);
  return files;
}
export function stableCompensationNetwork(raw: unknown) {
  const evidence = NativeCompensationNetworkEvidenceSchema.parse(raw);
  const closed = evidence.previousWorkflowClosed;
  return {
    schemaVersion: evidence.schemaVersion,
    lifecycleKind: evidence.lifecycleKind,
    planId: evidence.planId,
    recoveryEpoch: evidence.recoveryEpoch,
    configurationDigest: evidence.mounts.configurationDigest,
    targetsDigest: evidence.quiescence.targetsDigest,
    controllers: evidence.quiescence.controllers,
    mounts: evidence.mounts.mounts,
    previousWorkflowClosed:
      closed === null
        ? null
        : {
            operationId: closed.operationId,
            workflowId: closed.workflowId,
            runId: closed.runId,
            status: closed.status,
          },
    plex: {
      canonicalPaths: evidence.plex.canonicalPaths,
      retainedAbsence: evidence.plex.retainedAbsence.map(
        ({ inventoryDigest: _digest, ...item }) => item,
      ),
      inventory: evidence.plex.inventory.map(({ sectionId, kind }) => ({
        sectionId,
        kind,
      })),
      playback: {
        state: evidence.plex.playback.state,
        scopeHash: evidence.plex.playback.scopeHash,
      },
    },
    torrents: evidence.torrents,
  };
}

/** Exact fields emitted by the existing stableNativeNetwork projection. */
const Network = z.strictObject({
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  configurationDigest:
    NativeRecoveryNetworkEvidenceSchema.shape.mounts.shape.configurationDigest,
  targetsDigest:
    NativeRecoveryNetworkEvidenceSchema.shape.quiescence.shape.targetsDigest,
  controllers:
    NativeRecoveryNetworkEvidenceSchema.shape.quiescence.shape.controllers,
  mounts: NativeRecoveryNetworkEvidenceSchema.shape.mounts.shape.mounts,
  plex: NativeRecoveryNetworkEvidenceSchema.shape.plex,
  torrents: NativeRecoveryNetworkEvidenceSchema.shape.torrents,
});
export const PublishedPlexStableNetworkSchema = Network;
export const QuarantinePlexStableNetworkSchema = Network.extend({
  plex: NativeQuarantineNetworkEvidenceSchema.shape.plex,
});
const Archive = NativeArchiveNetworkEvidenceSchema.shape;
export const ArchivePlexStableNetworkSchema = Network.extend({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("superseded_archive"),
  supersededCoordinators: z
    .array(
      z.strictObject({
        continuationId: z.uuid(),
        closedCoordinator: z.strictObject({
          operationId: z.uuid(),
          workflowId: z.string(),
          runId: z.string(),
          status: z.enum([
            "COMPLETED",
            "FAILED",
            "CANCELLED",
            "TERMINATED",
            "TIMED_OUT",
          ]),
        }),
      }),
    )
    .optional(),
  plex: z.strictObject({
    currentPlayback: Archive.plex.shape.currentPlayback,
    archiveAbsence: z
      .array(
        Archive.plex.shape.archiveAbsence.element.omit({
          inventoryDigest: true,
        }),
      )
      .max(2500),
    inventory: z
      .array(
        Archive.plex.shape.inventory.element.pick({
          sectionId: true,
          kind: true,
        }),
      )
      .max(100),
    playback: Archive.plex.shape.playback.pick({
      state: true,
      scopeHash: true,
    }),
  }),
});
export const PublishedPlexStableFilesSchema = z.union([
  NativeRecoveryFileEvidenceSchema.omit({
    schemaVersion: true,
    capturedAt: true,
  }),
  NativePublishedFileEvidenceV2Schema.omit({ capturedAt: true }),
]);
export const QuarantinePlexStableFilesSchema =
  NativeQuarantineFileEvidenceSchema.omit({ capturedAt: true });
export const ArchivePlexStableFilesSchema =
  NativeArchiveFileEvidenceSchema.omit({ capturedAt: true });
export const NativePlexPolicyBindingSchema = z.strictObject({
  mediaId: z.uuid(),
  priorPolicyId: z.uuid(),
  policyId: z.uuid(),
  version: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  rulesHash: Hash,
  sourceHash: Hash,
});
