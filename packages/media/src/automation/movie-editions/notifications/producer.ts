import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieNoticeSource } from "./source.ts";
import { queueMovieNoticesV4 } from "./queue.ts";

/** Caller holds the exact movie/request scope and retains every returned guard through commit. */
export async function queueMoviePublicationNoticesV4(
  tx: Prisma.TransactionClient,
  input: { input: MovieAttemptOperationV4; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const source = await readMovieNoticeSource(tx, input.input, budget);
  const group = source.group;
  budget.consume(2);
  const binding = await readCurrentPlexBinding(tx, {
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
  });
  if (binding.status !== "current")
    throw new PlexBindingProtection(binding.reason);
  if (identityHash(binding.association.group) !== identityHash(group))
    throw new PlexBindingProtection("binding_changed");
  return queueMovieNoticesV4(
    tx,
    {
      access: input.access,
      draft: {
        schemaVersion: 4,
        kind: "movie_publication",
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
