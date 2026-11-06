import type { Prisma } from "#generated/prisma/client.ts";
import type { MoviePublicationIntentV2 } from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

const capturedRollback = Symbol("captured-movie-rollback-predecessor");
export type HeldMovieRollbackPredecessorV1 = {
  readonly [capturedRollback]: boolean;
  readonly tx: Prisma.TransactionClient;
  readonly budget: PublicationAuthorityReadBudget;
  readonly intentHash: string;
  readonly grantHash: string;
};

/** Called only by actual capture after its full snapshot/reference traversal,
 * while the shared producer holds the complete DB and native path locks. */
export function holdCapturedMovieRollbackPredecessorV1(
  tx: Prisma.TransactionClient,
  intent: MoviePublicationIntentV2,
  budget: PublicationAuthorityReadBudget,
): HeldMovieRollbackPredecessorV1 | undefined {
  const { predecessor, originalGrant } = intent.entries[0];
  if (originalGrant?.kind !== "movie_rollback_publication_v1") return undefined;
  if (
    originalGrant.assetId !== predecessor?.id ||
    originalGrant.assetVersion !== predecessor.version ||
    identityHash(originalGrant.scope) !== identityHash(predecessor.scope)
  )
    throw new Error(
      "Captured rollback predecessor lost its actual snapshot or reference",
    );
  return {
    [capturedRollback]: true,
    tx,
    budget,
    intentHash: identityHash(intent),
    grantHash: identityHash(originalGrant),
  };
}

/** No IO, cache or new authority: only the identical already-paid capture in
 * this exact held transaction may supply its immutable predecessor facts. */
export function assertHeldMovieRollbackPredecessorV1(
  tx: Prisma.TransactionClient,
  input: {
    intent: MoviePublicationIntentV2;
    budget: PublicationAuthorityReadBudget;
  },
  held: HeldMovieRollbackPredecessorV1,
) {
  if (
    !held[capturedRollback] ||
    held.tx !== tx ||
    held.budget !== input.budget ||
    held.intentHash !== identityHash(input.intent) ||
    held.grantHash !== identityHash(input.intent.entries[0].originalGrant) ||
    input.intent.entries[0].originalGrant?.kind !==
      "movie_rollback_publication_v1"
  )
    throw new Error(
      "Captured rollback predecessor crossed its transaction, original allowance or exact intent",
    );
}
