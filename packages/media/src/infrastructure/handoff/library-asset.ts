import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { HandoffNetworkV2Schema } from "#shared/handoff-v2.ts";
import { StableHandoffNetworkV3Schema } from "#shared/handoff/library-v3.ts";
import { LibraryAssetReferenceV1Schema } from "#shared/handoff/library-ownership.ts";
import { PublicationAssetSnapshotSchema } from "#shared/publication-proof/intent.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "./library-receipt.ts";
import { movieLibraryParentV2FromReceipt } from "#infrastructure/movie-editions/library-records.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type File = LibraryHandoffReceipt["selection"]["scope"]["files"][number];

/** Movie cuts and complete TV physical groups resolve from their actual initial receipt. */
export async function loadLibraryAssetParentV1(
  tx: Prisma.TransactionClient,
  input: { receiptId: string; assetId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const original = await readLibraryHandoffReceipt(tx, input.receiptId, budget);
  const { receipt, selection } = original;
  const files = selection.scope.files.filter(
    (file) => file.assetId === input.assetId,
  );
  const file = files[0];
  if (file === undefined || files.length !== 1)
    throw new Error("Initial library parent has no exact selected file");
  const measured = selection.fileEvidence.files.filter(
    (item) => item.assetId === input.assetId,
  );
  const measurement = measured[0];
  if (measurement === undefined || measured.length !== 1)
    throw new Error("Initial library parent has no exact physical measurement");
  const asset =
    file.libraryKind === "movies"
      ? movieLibraryParentV2FromReceipt({ ...original, assetId: input.assetId })
          .asset
      : tvAsset(original, file);
  const plex = initialAssociations(selection.networkEvidence, file);
  return {
    asset,
    actorId: receipt.actorId,
    file,
    scope: selection.scope,
    reference: LibraryAssetReferenceV1Schema.parse({
      kind: "library_adoption_v1",
      receiptId: receipt.id,
      planId: receipt.planId,
      planHash: receipt.planHash,
      assetId: asset.id,
      assetVersion: asset.version,
      bindingHash: hash(asset),
      physicalEvidenceHash: hash({ file: measurement, plex }),
    }),
  };
}

function tvAsset(original: LibraryHandoffReceipt, file: File) {
  const { selection, receipt } = original;
  const snapshots = selection.assets.filter(
    (asset) => asset.id === file.assetId,
  );
  const measurements = selection.fileEvidence.files.filter(
    (item) => item.assetId === file.assetId,
  );
  const measured = measurements[0];
  if (
    measured === undefined ||
    snapshots.length !== 1 ||
    measurements.length !== 1
  )
    throw new Error("Initial TV parent has no exact owner snapshot");
  const asset = PublicationAssetSnapshotSchema.parse(snapshots[0]);
  if (
    file.libraryKind !== "tv" ||
    file.classification !== null ||
    file.edition !== "default" ||
    file.existingAssetId !== null ||
    asset.version !== 0 ||
    asset.state !== "published" ||
    asset.ownershipEpoch !== receipt.recoveryEpoch ||
    asset.path !== file.canonicalPath ||
    asset.sourcePath !== file.sourcePath ||
    measured.canonicalPath !== asset.path ||
    asset.checksum !== measured.checksum ||
    asset.sizeBytes !== measured.sizeBytes ||
    asset.sizeBytes !== file.sizeBytes ||
    asset.coverage.some((item) => !item.current) ||
    hash(asset.coverage.map((item) => item.mediaId).sort()) !==
      hash([...file.mediaIds].sort())
  )
    throw new Error(
      "Initial TV parent lost its complete physical episode owner",
    );
  return asset;
}

function initialAssociations(raw: unknown, file: File) {
  const header = z
    .object({ schemaVersion: z.union([z.literal(2), z.literal(3)]) })
    .parse(raw);
  const network =
    header.schemaVersion === 3
      ? StableHandoffNetworkV3Schema.parse(raw)
      : z.object({ plex: HandoffNetworkV2Schema.shape.plex }).parse(raw);
  const plex = network.plex
    .filter((item) => item.assetId === file.assetId)
    .sort((a, b) => a.mediaId.localeCompare(b.mediaId));
  if (
    plex.some(
      (item) =>
        item.canonicalPath !== file.canonicalPath ||
        item.edition !== file.edition,
    ) ||
    hash(plex.map((item) => item.mediaId).sort()) !==
      hash([...file.mediaIds].sort())
  )
    throw new Error(
      "Initial library parent lost its exact Plex episode and Part coverage",
    );
  return plex;
}
