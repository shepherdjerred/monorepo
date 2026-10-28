import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRestorationNoticeSource } from "./source.ts";
import { queueMovieNoticesV4 } from "./queue.ts";

/** Real restore completion supplies availability; personal choices supply recipients. */
export async function queueMovieRestorationNoticesV4(
  tx: Prisma.TransactionClient,
  input: { input: MovieOperationV4; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const source = await readMovieRestorationNoticeSource(
    tx,
    input.input,
    budget,
  );
  const group = source.group;
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: {
        mediaId: input.input.scope.mediaId,
        edition: input.input.scope.edition,
      },
      assetId: group.assetId,
      access: {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        sectionType: "movie",
      },
    },
    budget,
  );
  if (binding.status !== "current")
    throw new PlexBindingProtection(binding.reason);
  if (
    identityHash(binding.snapshot) !== identityHash(source.receipt.binding) ||
    identityHash(binding.association.group) !== identityHash(group)
  )
    throw new PlexBindingProtection("binding_changed");
  return queueMovieNoticesV4(
    tx,
    {
      access: input.access,
      draft: {
        schemaVersion: 4,
        kind: "movie_restoration",
        eventKind: source.eventKind,
        source: input.input,
        publicationHash: source.publicationHash,
        recoveryEpoch: group.ownershipEpoch,
        asset: {
          id: group.assetId,
          version: group.assetVersion,
          checksum: group.checksum,
        },
      },
    },
    budget,
  );
}
