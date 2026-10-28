import type { Prisma } from "#generated/prisma/client.ts";
import type { z } from "zod";
import type { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export function assertMovieRestoreOriginalAccess(
  access: MovieChoiceAccess,
  original: PlexAccess,
) {
  if (
    original.serverMachineId !== access.serverMachineId ||
    original.sectionId !== access.movieSectionId ||
    original.sectionType !== "movie"
  )
    throw new PlexBindingProtection("wrong_section");
}

/** Restore retains the actual immutable Plex item and Part which existed before quarantine. */
export async function readMovieRestoreOriginalItem(
  tx: Prisma.TransactionClient,
  quarantine: z.infer<typeof MovieQuarantinePlexReceiptV2Schema>,
  budget: PublicationAuthorityReadBudget,
) {
  const binding = quarantine.bindings[0];
  const row = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: binding.evidenceId },
  });
  budget.consume(1);
  const association = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    row.evidence,
    row.associationHash,
  );
  if (
    row.associationHash !== binding.associationHash ||
    row.mediaId !== binding.scope.mediaId ||
    row.edition !== binding.scope.edition ||
    row.assetId !== quarantine.groups[0].assetId ||
    row.serverMachineId !== association.access.serverMachineId ||
    identityHash(association.scope) !== identityHash(binding.scope) ||
    identityHash(association.group) !== identityHash(quarantine.groups[0])
  )
    throw new Error(
      "Movie restore original Plex identity changed its quarantine parent",
    );
  const part = association.item.media[0].parts[0];
  return {
    item: {
      binding,
      ratingKey: association.item.ratingKey,
      part: { id: part.id, file: part.file },
    },
    access: association.access,
  };
}
