import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { HandoffNetworkV2Schema } from "#shared/handoff-v2.ts";
import type { LibraryHandoffSelectionProtocolSchema } from "#shared/handoff/protocol.ts";
import { StableHandoffNetworkV3Schema } from "#shared/handoff/library-v3.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "#infrastructure/handoff/library-receipt.ts";
import {
  MovieLibraryReferenceV2Schema,
  MoviePublicationAssetV2Schema,
} from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieDefinitionRef } from "./definition.ts";
import { MOVIE_EDITION_REGISTRY } from "#shared/movie-editions/registry.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type Selection = z.infer<typeof LibraryHandoffSelectionProtocolSchema>;
type Asset = z.infer<typeof MoviePublicationAssetV2Schema>;

/** Read original immutable ownership, without consulting current intent, flags or runtime. */
export async function loadMovieLibraryParentV2(
  tx: Prisma.TransactionClient,
  input: { receiptId: string; assetId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const original = await readLibraryHandoffReceipt(tx, input.receiptId, budget);
  return movieLibraryParentV2FromReceipt({
    ...original,
    assetId: input.assetId,
  });
}

export function movieLibraryParentV2FromReceipt(
  input: LibraryHandoffReceipt & { assetId: string },
) {
  const { receipt, selection } = input;
  const scope = selection.scope;
  const files = scope.files.filter((file) => file.assetId === input.assetId);
  const snapshots = selection.assets.filter(
    (asset) => asset.id === input.assetId,
  );
  const measurements = selection.fileEvidence.files.filter(
    (file) => file.assetId === input.assetId,
  );
  if (files.length !== 1 || snapshots.length !== 1 || measurements.length !== 1)
    throw new Error(
      "Initial movie parent must have one actual file and owner snapshot",
    );
  const file = files[0];
  const measured = measurements[0];
  const asset = MoviePublicationAssetV2Schema.parse(snapshots[0]);
  if (file === undefined || measured === undefined)
    throw new Error("Initial movie parent file disappeared");
  assertOwner(receipt.recoveryEpoch, file, measured, asset);
  const association = plexAssociation(selection.networkEvidence, asset);
  const reference = MovieLibraryReferenceV2Schema.parse({
    kind: "movie_library_adoption_v2",
    scope: asset.scope,
    receiptId: receipt.id,
    planId: receipt.planId,
    planHash: receipt.planHash,
    assetId: asset.id,
    assetVersion: asset.version,
    bindingHash: hash(asset),
    physicalEvidenceHash: hash({ file: measured, plex: association }),
  });
  return { reference, asset };
}

function assertOwner(
  epoch: number,
  file: Selection["scope"]["files"][number],
  measured: Selection["fileEvidence"]["files"][number],
  asset: Asset,
) {
  if (
    file.libraryKind !== "movies" ||
    file.classification === null ||
    file.existingAssetId !== null ||
    hash(file.mediaIds) !== hash([asset.scope.mediaId]) ||
    file.edition !== asset.scope.edition ||
    asset.path !== file.canonicalPath ||
    asset.sourcePath !== file.sourcePath ||
    asset.checksum !== measured.checksum ||
    asset.sizeBytes !== measured.sizeBytes ||
    measured.canonicalPath !== asset.path ||
    asset.ownershipEpoch !== epoch ||
    asset.version !== 0 ||
    asset.state !== "published" ||
    !asset.coverage[0].current ||
    file.classification.definition.definitionDigest !==
      movieDefinitionRef(asset.scope.mediaId, asset.scope.edition)
        .definitionDigest
  )
    throw new Error(
      "Initial movie parent lost its exact classified physical owner",
    );
}

function plexAssociation(network: unknown, asset: Asset) {
  const protocol = z
    .object({ schemaVersion: z.union([z.literal(2), z.literal(3)]) })
    .parse(network);
  const plex = (
    protocol.schemaVersion === 3
      ? StableHandoffNetworkV3Schema.parse(network)
      : z
          .object({
            schemaVersion: z.literal(2),
            plex: HandoffNetworkV2Schema.shape.plex,
          })
          .parse(network)
  ).plex.filter((item) => item.assetId === asset.id);
  const association = plex[0];
  if (
    plex.length !== 1 ||
    association?.mediaId !== asset.scope.mediaId ||
    association.edition !== asset.edition ||
    association.canonicalPath !== asset.path ||
    (association.editionTitle ?? "") !==
      MOVIE_EDITION_REGISTRY[asset.scope.edition].plexLabel
  )
    throw new Error("Initial movie parent lost its exact Plex cut and Part");
  return association;
}
