import type { Prisma } from "#generated/prisma/client.ts";
import type { MoviePublicationReferenceV2 } from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadMovieRestorePublicationParentV1 } from "#infrastructure/movie-editions/publication/restore-records.ts";
import { loadMovieRollbackPublicationParentV1 } from "#infrastructure/movie-editions/rollback/parent.ts";
import { loadMovieLibraryParentV2 } from "#infrastructure/movie-editions/library-records.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** The exact historical video version, independent of current captions and permission. */
export async function readMovieReplacementVideoParentV2(
  tx: Prisma.TransactionClient,
  reference: MoviePublicationReferenceV2,
  budget: PublicationAuthorityReadBudget,
) {
  if (reference.kind === "movie_rollback_publication_v1") {
    const parent = await loadMovieRollbackPublicationParentV1(
      tx,
      reference,
      budget,
    );
    return parent.asset;
  }
  if (reference.kind === "movie_restore_publication_v1") {
    const parent = await loadMovieRestorePublicationParentV1(
      tx,
      reference,
      budget,
    );
    return parent.asset;
  }
  if (reference.kind === "movie_library_adoption_v2") {
    const parent = await loadMovieLibraryParentV2(tx, reference, budget);
    const { subtitleLineage: _lineage, ...literal } = reference;
    if (hash(parent.reference) !== hash(literal))
      throw new Error("Movie caption replacement library parent changed");
    return parent.asset;
  }
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: reference.transitionId },
  });
  budget.consume(1);
  const parent = await loadMoviePublicationV2(tx, row.attemptId, budget);
  if (
    parent?.outcome == null ||
    parent.outcomeHash !== reference.outcomeHash ||
    parent.reference.intentHash !== reference.intentHash
  )
    throw new Error("Movie caption replacement publication parent changed");
  const result = parent.outcome.entries[0];
  const asset =
    result.successor?.id === reference.assetId
      ? result.successor
      : result.predecessor;
  if (
    asset?.id !== reference.assetId ||
    asset.version !== reference.assetVersion ||
    hash(asset.scope) !== hash(reference.scope) ||
    hash(asset) !== reference.bindingHash ||
    hash({
      effects: parent.outcome.effects,
      participants: result.participants,
      journals: result.journals,
    }) !== reference.physicalEvidenceHash
  )
    throw new Error("Movie caption replacement exact video binding changed");
  return asset;
}
