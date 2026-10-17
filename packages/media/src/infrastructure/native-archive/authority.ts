import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveBindingSchema,
  type NativeArchiveFile,
  type NativeArchiveBinding,
} from "#shared/native-recovery/archive.ts";
import type { PublicationAuthorityReference } from "#shared/publication-proof/references.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { publicationArchiveSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { findPublicationOriginalGrant } from "#infrastructure/publication-proof/grants.ts";
import { resolvePublicationTransitionAuthority } from "#infrastructure/publication-proof/authority.ts";
import { resolveCompensationPhysicalReference } from "#infrastructure/native-compensation/receipts.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import {
  assertPriorNativeBinding,
  priorNativeFileEvidence,
} from "./prior-binding.ts";
import { PublicationParticipantSchema } from "#shared/publication-proof/intent.ts";
import { NativeArchiveScopeProtection } from "./errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function resolveArchiveAuthority(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  budget?: PublicationAuthorityReadBudget,
): Promise<PublicationAuthorityReference> {
  const asset = await snapshotPublicationAsset(tx, file.assetId);
  const reference = await findPublicationOriginalGrant(
    tx,
    { asset, libraryKind: file.libraryKind },
    budget,
  );
  if (reference === null)
    throw new NativeArchiveScopeProtection(
      "Current archive participant lacks exact native or adjacent publication authority",
    );
  return reference;
}

/** Effective projection only. Reuse never writes these as new receipt grants. */
export async function assertArchiveAuthority(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  reference: PublicationAuthorityReference,
  budget?: PublicationAuthorityReadBudget,
): Promise<NativeArchiveBinding> {
  if (reference.kind === "prior_native_binding")
    return NativeArchiveBindingSchema.parse({
      ...(await assertPriorNativeBinding(tx, file, reference, budget)),
      physicalIdentityHash: reference.physicalEvidenceHash,
    });
  const actual =
    reference.kind === "compensation_completion"
      ? await resolveCompensationPhysicalReference(
          tx,
          { continuationId: reference.continuationId, assetId: file.assetId },
          budget,
        )
      : await resolvePublicationTransitionAuthority(
          tx,
          { transitionId: reference.transitionId, assetId: file.assetId },
          budget,
        );
  const comparable =
    actual.kind === "publication_transition_binding"
      ? (({ originalGrant: _original, ...value }) => value)(actual)
      : actual;
  if (
    snapshotHash(nativeJson(comparable)) !== snapshotHash(nativeJson(reference))
  )
    throw new Error("Archive physical authority reference changed");
  const current = publicationArchiveSnapshot(
    await snapshotPublicationAsset(tx, file.assetId),
    file.libraryKind,
  );
  if (
    snapshotHash(
      nativeJson({ ...current, role: file.role, authority: file.authority }),
    ) !== snapshotHash(nativeJson(file))
  )
    throw new Error("Archive adjacent physical snapshot changed");
  return {
    assetId: file.assetId,
    beforeVersion: file.assetVersion,
    assetVersion: file.assetVersion,
    checksum: file.checksum,
    mediaIds: file.mediaIds,
    ownershipEpoch: file.ownershipEpoch,
    physicalIdentityHash: reference.physicalEvidenceHash,
    subtitles: file.subtitles.map((item) => {
      const version = {
        version: item.version,
        ownershipEpoch: item.ownershipEpoch,
        videoVersion: item.videoVersion,
      };
      return {
        id: item.id,
        before: version,
        after: version,
        qualityStatus: item.qualityStatus,
      };
    }),
  };
}

/** Stored physical evidence is an audit projection, never a process-local capability. */
export async function archiveAuthorityParticipants(
  tx: Prisma.TransactionClient,
  reference: PublicationAuthorityReference,
  budget?: PublicationAuthorityReadBudget,
) {
  if (reference.kind === "prior_native_binding") {
    const asset = await snapshotPublicationAsset(tx, reference.assetId);
    const libraryKind = asset.path.startsWith("/data/movies/")
      ? "movies"
      : asset.path.startsWith("/data/tv/")
        ? "tv"
        : null;
    if (libraryKind === null)
      throw new Error("Native physical evidence library root changed");
    const file = publicationArchiveSnapshot(asset, libraryKind);
    const evidence = await priorNativeFileEvidence(tx, file, reference, budget);
    const replacements = new Set(
      reference.subtitleLineage?.replacements.map((item) => item.beforeId),
    );
    const parts = [
      {
        subtitleId: null,
        canonicalPath: evidence.canonicalPath,
        checksum: evidence.checksum,
        sizeBytes: evidence.sizeBytes,
        identity: evidence.identity,
      },
      ...evidence.subtitles
        .filter(
          (item) =>
            item.storageKind === "sidecar" && !replacements.has(item.id),
        )
        .map((item) => ({ ...item, subtitleId: item.id })),
    ];
    return parts.map((item) => {
      if (item.canonicalPath?.startsWith(`/data/${libraryKind}/`) !== true)
        throw new Error("Native original participant path changed");
      const control = `/data/${libraryKind}/.media-control/`;
      const isControl = item.canonicalPath.startsWith(control);
      return PublicationParticipantSchema.parse({
        assetId: asset.id,
        subtitleId: item.subtitleId,
        libraryKind,
        role: item.subtitleId === null ? "video" : "sidecar",
        physical: {
          root: isControl ? "control" : "library",
          path: item.canonicalPath.slice(
            isControl ? control.length : `/data/${libraryKind}/`.length,
          ),
          state: "present",
          sha256: item.checksum,
          sizeBytes: item.sizeBytes,
          identity: item.identity,
        },
      });
    });
  }
  if (reference.kind === "compensation_completion") {
    const actual = await resolveCompensationPhysicalReference(
      tx,
      { continuationId: reference.continuationId, assetId: reference.assetId },
      budget,
    );
    if (
      snapshotHash(nativeJson(actual)) !== snapshotHash(nativeJson(reference))
    )
      throw new Error("Archive compensation reference changed");
    const record = await compensationRecord(
      tx,
      reference.continuationId,
      budget,
    );
    const binding = record.completion?.predecessorBindings.find(
      (item) => item.after.id === reference.assetId,
    );
    if (binding === undefined)
      throw new Error("Archive compensation physical participants missing");
    const replacements = actual.subtitleLineage?.replacements ?? [];
    return binding.participants.filter(
      (participant) =>
        participant.subtitleId === null ||
        !replacements.some(
          (replacement) => replacement.beforeId === participant.subtitleId,
        ),
    );
  }
  const { originalGrant: _original, ...actual } =
    await resolvePublicationTransitionAuthority(
      tx,
      { transitionId: reference.transitionId, assetId: reference.assetId },
      budget,
    );
  if (snapshotHash(nativeJson(actual)) !== snapshotHash(nativeJson(reference)))
    throw new Error("Archive transition reference changed");
  budget?.consume(1);
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: reference.transitionId },
  });
  const outcome = PublicationOutcomeSchema.parse(row.outcome);
  const entry = outcome.entries.find(
    (item) =>
      item.predecessor?.id === reference.assetId ||
      item.successor?.id === reference.assetId,
  );
  if (entry === undefined)
    throw new Error("Archive transition physical participants missing");
  return entry.participants.filter(
    (item) =>
      item.assetId === reference.assetId &&
      reference.subtitleLineage?.replacements.some(
        (replacement) => replacement.beforeId === item.subtitleId,
      ) !== true,
  );
}
