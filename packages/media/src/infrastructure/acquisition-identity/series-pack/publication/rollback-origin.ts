import type { Prisma } from "#generated/prisma/client.ts";
import {
  managedSeriesIdentity,
  type LibrarySeriesManagement,
} from "#shared/acquisition/library-management.ts";
import {
  PlexAssociationSchema,
  type PlexPhysicalGroup,
  type PlexAssociation,
} from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  PublicationAssetSnapshotSchema,
  type PublicationAssetSnapshot,
} from "#shared/publication-proof/intent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

type Parent = Awaited<ReturnType<typeof readLibraryHandoffReceipt>>;
type Captured = Exclude<LibrarySeriesManagement, { schemaVersion: 3 }>;

function assertParent(input: {
  parent: Parent;
  captured: Captured;
  association: PlexAssociation;
  evidence: Prisma.PlexAssociationEvidenceGetPayload<Record<string, never>>;
  epoch: number;
  seriesId: string;
}) {
  const { parent, captured, association, evidence } = input;
  if (
    parent.receipt.recoveryEpoch !== input.epoch ||
    parent.receipt.planId !== captured.planId ||
    parent.receipt.planHash !== captured.planHash ||
    parent.receipt.actorId !== captured.actorId ||
    evidence.associationHash !== captured.association.associationHash ||
    association.kind !== "episode" ||
    association.editionRootId !== input.seriesId ||
    association.access.serverMachineId !== captured.serverMachineId ||
    association.access.sectionId !== captured.sectionId ||
    !parent.selection.scope.files.some(
      (file) => file.assetId === evidence.assetId && file.libraryKind === "tv",
    )
  )
    throw new PlexBindingProtection("ownership_changed");
}

function assertInitialFile(input: {
  asset: PublicationAssetSnapshot;
  file: Parent["selection"]["scope"]["files"][number];
  measured: Parent["selection"]["fileEvidence"]["files"][number] | undefined;
  epoch: number;
}) {
  const { asset, file, measured } = input;
  if (
    measured?.checksum !== asset.checksum ||
    asset.ownershipEpoch !== input.epoch ||
    asset.state !== "published" ||
    asset.version !== 0 ||
    (file.capturedChecksum !== null &&
      file.capturedChecksum !== asset.checksum) ||
    asset.path !== file.canonicalPath ||
    asset.sizeBytes !== file.sizeBytes ||
    measured.canonicalPath !== asset.path ||
    measured.sizeBytes !== asset.sizeBytes ||
    identityHash(
      asset.coverage
        .filter((row) => row.current)
        .map((row) => row.mediaId)
        .sort(),
    ) !== identityHash([...file.mediaIds].sort())
  )
    throw new PlexBindingProtection("ownership_changed");
}

function captureInitialFiles(
  parent: Parent,
  input: { seriesId: string; epoch: number },
  originals: Map<string, PublicationAssetSnapshot>,
) {
  for (const value of parent.selection.assets) {
    const file = parent.selection.scope.files.find(
      (row) => row.assetId === value.id && row.libraryKind === "tv",
    );
    if (file === undefined) continue;
    const asset = PublicationAssetSnapshotSchema.parse(value);
    if (asset.editionRootId !== input.seriesId || originals.has(asset.id))
      throw new PlexBindingProtection("ownership_changed");
    const measured = parent.selection.fileEvidence.files.find(
      (row) => row.assetId === asset.id,
    );
    assertInitialFile({ asset, file, measured, epoch: input.epoch });
    originals.set(asset.id, asset);
  }
}

/** Genuine initial-library files remain library imports; a rollback never invents acquisition lineage. */
export async function loadSeriesPackLibraryRollbackOriginsV1(
  tx: Prisma.TransactionClient,
  input: { identity: unknown; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  const identity = managedSeriesIdentity(input.identity);
  if (identity === null || !("seriesPackV1" in identity.source)) return null;
  const management = identity.management;
  const approvals =
    management.schemaVersion === 3 ? management.approvals : [management];
  const originals = new Map<string, PublicationAssetSnapshot>();
  for (const captured of approvals) {
    const parent = await readLibraryHandoffReceipt(
      tx,
      captured.receiptId,
      budget,
    );
    const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
      where: { id: captured.association.evidenceId },
    });
    budget.consume(1);
    const association = parsePlexRecord(
      PlexAssociationSchema,
      evidence.evidence,
      evidence.associationHash,
    );
    assertParent({
      parent,
      captured,
      association,
      evidence,
      epoch: input.epoch,
      seriesId: management.seriesId,
    });
    captureInitialFiles(
      parent,
      { seriesId: management.seriesId, epoch: input.epoch },
      originals,
    );
  }
  return originals;
}

export function assertSeriesPackLibraryPredecessorV1(
  original: PublicationAssetSnapshot,
  predecessor: PublicationAssetSnapshot | null,
) {
  if (
    predecessor?.id !== original.id ||
    predecessor.version !== original.version ||
    predecessor.checksum !== original.checksum ||
    predecessor.path !== original.path ||
    predecessor.sizeBytes !== original.sizeBytes ||
    predecessor.ownershipEpoch !== original.ownershipEpoch ||
    predecessor.editionRootId !== original.editionRootId ||
    identityHash(predecessor.coverage) !== identityHash(original.coverage)
  )
    throw new PlexBindingProtection("ownership_changed");
}

export async function seriesPackLibraryRollbackOriginsV1(
  tx: Prisma.TransactionClient,
  input: { identity: unknown; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  const originals = await loadSeriesPackLibraryRollbackOriginsV1(
    tx,
    input,
    budget,
  );
  if (originals === null) return null;
  return (
    group: PlexPhysicalGroup,
    predecessor: PublicationAssetSnapshot | null,
  ) => {
    const original = originals.get(group.assetId);
    if (original === undefined) return false;
    assertSeriesPackLibraryPredecessorV1(original, predecessor);
    const same = {
      predecessorId: predecessor?.id === original.id,
      predecessorVersion: predecessor?.version === original.version,
      predecessorChecksum: predecessor?.checksum === original.checksum,
      predecessorPath: predecessor?.path === original.path,
      predecessorSize: predecessor?.sizeBytes === original.sizeBytes,
      predecessorEpoch: predecessor?.ownershipEpoch === original.ownershipEpoch,
      restoredVersion: group.assetVersion === original.version + 2,
      restoredChecksum: group.checksum === original.checksum,
      restoredPath: group.canonicalPath === original.path,
      restoredSize: group.sizeBytes === original.sizeBytes,
      restoredRoot: group.canonicalRootId === original.editionRootId,
      restoredEpoch: group.ownershipEpoch === input.epoch,
      restoredCoverage:
        identityHash(group.coverage) ===
        identityHash(
          original.coverage
            .filter((row) => row.current)
            .map(({ mediaId, edition }) => ({ mediaId, edition })),
        ),
    };
    const changed = Object.entries(same)
      .filter(([, valid]) => !valid)
      .map(([field]) => field);
    if (changed.length > 0) {
      const error = new PlexBindingProtection("ownership_changed");
      error.cause = new Error(
        `Initial-library rollback identity changed: ${changed.join(", ")}`,
      );
      throw error;
    }
    return true;
  };
}
