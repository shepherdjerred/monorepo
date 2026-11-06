import type { Prisma } from "#generated/prisma/client.ts";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MovieReplacementSnapshotV2 } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadMovieRollbackPublicationParentV1 } from "#infrastructure/movie-editions/rollback/parent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertMovieReplacementVideoV2 } from "./current-video.ts";

const heldSource = Symbol("held-movie-rollback-caption-source");
export type HeldMovieRollbackCaptionSourceV1 = {
  readonly [heldSource]: boolean;
  readonly tx: Prisma.TransactionClient;
  readonly budget: PublicationAuthorityReadBudget;
  readonly parent: Awaited<
    ReturnType<typeof loadMovieRollbackPublicationParentV1>
  >;
  readonly publication: Extract<
    MovieReplacementSnapshotV2["publication"],
    { kind: "movie_rollback_publication_v1" }
  >;
  readonly oldHash: string;
};

/** Native apply already holds the complete replacement/movie/asset locks.
 * Lock and resolve this new immutable source once in THIS transaction only. */
export async function holdMovieRollbackCaptionSourceV1(
  tx: Prisma.TransactionClient,
  snapshot: MovieReplacementSnapshotV2,
  context: FileContext,
): Promise<HeldMovieRollbackCaptionSourceV1 | undefined> {
  if (
    snapshot.source.kind !== "video_baseline" ||
    snapshot.publication.kind !== "movie_rollback_publication_v1"
  )
    return undefined;
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Held rollback caption source lost its original invocation",
    );
  if (
    identityHash(snapshot.source.publication) !==
    identityHash(snapshot.publication)
  )
    throw new Error(
      "Held rollback caption source changed its exact publication",
    );
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${snapshot.publication.operationId} FOR SHARE`;
  const parent = await loadMovieRollbackPublicationParentV1(
    tx,
    snapshot.publication,
    invocation.budget,
  );
  if (
    !parent.asset.subtitles.some(
      (row) => identityHash(row) === identityHash(snapshot.old),
    )
  )
    throw new Error("Held rollback baseline does not own this exact caption");
  invocation.execution.assertActive();
  return {
    [heldSource]: true,
    tx,
    budget: invocation.budget,
    parent,
    publication: snapshot.publication,
    oldHash: identityHash(snapshot.old),
  };
}

/** Current callers still capture all live rows and authority before this pure
 * immutable-parent comparison. The capability cannot cross a TX or budget. */
export function resolveHeldMovieRollbackCaptionSourceV1(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    asset: Parameters<typeof assertMovieReplacementVideoV2>[0];
    old: NativeSubtitleSnapshot;
  },
  authority: {
    budget: PublicationAuthorityReadBudget;
    source: HeldMovieRollbackCaptionSourceV1;
  },
) {
  const held = authority.source;
  if (
    !held[heldSource] ||
    held.tx !== tx ||
    held.budget !== authority.budget ||
    identityHash(input.old) !== held.oldHash ||
    identityHash(input.scope) !== identityHash(held.publication.scope)
  )
    throw new FileGuardError("subtitle_replacement_rollback_source_changed");
  assertMovieReplacementVideoV2(input.asset, held.parent.asset, input.scope);
  return {
    publication: held.publication,
    source: { kind: "video_baseline" as const, publication: held.publication },
  };
}
