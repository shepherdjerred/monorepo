import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import { NativeQuarantineNetworkEvidenceSchema } from "#shared/native-recovery/quarantine.ts";
import {
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveCleanupNetworkEvidenceSchema,
} from "#shared/native-recovery/archive.ts";
import {
  NativeCompensationNetworkEvidenceSchema,
  NativeCompensationExecutionNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";
import type { NativePlexProofParent } from "#shared/plex-binding/native.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import type { CanonicalMountEvidence } from "#shared/canonical-storage.ts";
import type { observeNativeTorrents } from "#migration/native-network/torrents.ts";
import type { observeSupersededCoordinators } from "#migration/native-archive/coordinators.ts";
import type { previousCoordinator } from "#migration/native-compensation/evidence.ts";
import { associationHash } from "#automation/publication/association/projection.ts";
import type { NativeScope, NativeCatalogScope } from "./scope.ts";
import type { scanNativePlex, finishNativePlex } from "./observation.ts";

/** New paired proof keeps the established lifecycle network shape. Old version serializers remain untouched. */
export function nativeNetworkEvidence(input: {
  parent: NativePlexProofParent;
  scope: NativeScope;
  catalog: NativeCatalogScope;
  scanned: Awaited<ReturnType<typeof scanNativePlex>>;
  finished: Awaited<ReturnType<typeof finishNativePlex>>;
  quiescence: QuiescenceEvidence;
  mounts: CanonicalMountEvidence;
  torrents: Awaited<ReturnType<typeof observeNativeTorrents>>;
  supersededCoordinators: Awaited<
    ReturnType<typeof observeSupersededCoordinators>
  >;
  previousWorkflowClosed: Awaited<ReturnType<typeof previousCoordinator>>;
}) {
  const { parent, scope, catalog, scanned, finished } = input;
  const common = {
    planId: parent.planId,
    recoveryEpoch: parent.recoveryEpoch,
    capturedAt: finished.timing.startedAt,
    expiresAt: finished.timing.expiresAt,
    quiescence: input.quiescence,
    mounts: input.mounts,
    torrents: input.torrents,
  };
  const selected = scanned.selected.map(({ group, items }) => ({
    group,
    items: items.map((item) => ({
      mediaId: item.target.scope.mediaId,
      ratingKey: item.identity.ratingKey,
      sectionId: group.access.sectionId,
      canonicalPath: group.canonicalPath,
      identityHash: associationHash({
        server: group.access.serverMachineId,
        sectionId: group.access.sectionId,
        mediaId: item.target.scope.mediaId,
        path: group.canonicalPath,
        ratingKey: item.identity.ratingKey,
        guids: item.wire.Guid ?? [],
        seriesGuids: item.series?.Guid ?? [],
        season: item.wire.parentIndex ?? null,
        episode: item.wire.index ?? null,
      }),
    })),
  }));
  if (parent.lifecycleKind === "published")
    return NativeRecoveryNetworkEvidenceSchema.parse({
      ...common,
      schemaVersion: 1,
      plex: selected.flatMap((group) => group.items),
    });
  if (parent.lifecycleKind === "committed_quarantine")
    return NativeQuarantineNetworkEvidenceSchema.parse({
      ...common,
      schemaVersion: 2,
      lifecycleKind: parent.lifecycleKind,
      plex: scope.files.flatMap((file) =>
        file.mediaIds.map((mediaId) => {
          const access = catalog.access.find(
            (value) =>
              value.sectionType ===
              (file.libraryKind === "movies" ? "movie" : "show"),
          );
          const target = scope.media.find((value) => value.id === mediaId);
          if (access === undefined || target === undefined)
            throw new Error("Native quarantine identity missing");
          return {
            mediaId,
            sectionId: access.sectionId,
            canonicalPath: file.canonicalPath,
            state: "quarantined_absent",
            activePlayback: false,
            identityHash: associationHash({
              server: access.serverMachineId,
              sectionId: access.sectionId,
              mediaId,
              canonicalPath: file.canonicalPath,
              reviewedIdentity: target,
            }),
          };
        }),
      ),
    });
  const inventory = scanned.sections.map((section) => {
    const rows = scanned.inventory.filter(
      (row) => row.section.sectionId === section.sectionId,
    );
    return {
      sectionId: section.sectionId,
      kind: section.sectionType === "movie" ? "movie" : "episode",
      itemCount: rows.length,
      digest: associationHash(rows.map((row) => row.projection)),
    };
  });
  const absence = catalog.absent.flatMap((group) =>
    inventory.map((section) => ({
      assetId: group.assetId,
      sectionId: section.sectionId,
      paths: group.paths,
      inventoryDigest: section.digest,
    })),
  );
  if (parent.lifecycleKind === "superseded_archive") {
    const review = NativeArchiveNetworkEvidenceSchema.parse({
      ...common,
      schemaVersion: 2,
      lifecycleKind: parent.lifecycleKind,
      ...(input.supersededCoordinators === undefined
        ? {}
        : { supersededCoordinators: input.supersededCoordinators }),
      plex: {
        currentPlayback: selected.map((value) => {
          const file = scope.files.find(
            (candidate) =>
              candidate.canonicalPath === value.group.canonicalPath,
          );
          if (file === undefined)
            throw new Error("Native current playback descriptor missing");
          return {
            assetId: file.assetId,
            assetVersion: file.assetVersion,
            checksum: file.checksum,
            mediaIds: file.mediaIds,
            items: value.items,
          };
        }),
        archiveAbsence: absence,
        inventory,
        playback: finished.playback,
      },
    });
    return parent.purpose === "native_execution"
      ? NativeArchiveCleanupNetworkEvidenceSchema.parse({
          ...review,
          continuationId: parent.continuationId,
          operationId: parent.operationId,
        })
      : review;
  }
  const review = NativeCompensationNetworkEvidenceSchema.parse({
    ...common,
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    previousWorkflowClosed: input.previousWorkflowClosed,
    plex: {
      canonicalPaths: selected.map((value) => {
        const descriptor = catalog.compensation?.find(
          (entry) => entry.canonicalPath === value.group.canonicalPath,
        );
        if (descriptor === undefined)
          throw new Error("Native candidate descriptor missing");
        return {
          assetId: descriptor.compatiblePhysicalCandidates[0].assetId,
          mediaIds: descriptor.targets.map((target) => target.scope.mediaId),
          canonicalPath: descriptor.canonicalPath,
          sectionId: descriptor.access.sectionId,
          items: value.items.map((item) => ({
            ratingKey: item.ratingKey,
            identityHash: item.identityHash,
          })),
        };
      }),
      retainedAbsence: absence,
      inventory,
      playback: finished.playback,
    },
  });
  return parent.purpose === "native_execution"
    ? NativeCompensationExecutionNetworkEvidenceSchema.parse({
        ...review,
        continuationId: parent.continuationId,
        operationId: parent.operationId,
        descriptorHash: parent.descriptorHash,
      })
    : review;
}
