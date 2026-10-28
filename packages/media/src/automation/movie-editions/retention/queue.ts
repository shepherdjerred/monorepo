import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import {
  lockWatchAuthority,
  watchScope,
  type WatchAuthority,
} from "#automation/plex-events/authority.ts";
import {
  watchAwait,
  watchCheckpoint,
  type WatchExecution,
} from "#automation/plex-events/execution.ts";
import { watchDeadline } from "#automation/plex-events/deadline.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";

/** The actual v2 association selects v4 even for an unmarked movie. Never infer from a filename. */
export async function queueMovieRetentionFromWatch(
  tx: Prisma.TransactionClient,
  authority: WatchAuthority,
  bucket: string,
  execution: WatchExecution,
): Promise<boolean> {
  const binding = authority.binding;
  if (binding === null) return true;
  const association = binding.association;
  if (association.schemaVersion !== 2) {
    if ((authority.scope.edition ?? "default") !== "default")
      throw new Error("Named movie retention requires its scoped association");
    return false;
  }
  if (authority.scope.budget === undefined)
    throw new Error(
      "Movie retention queue requires its original watch provenance budget",
    );
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: association.editionRootId,
    mediaId: association.scope.mediaId,
    edition: association.scope.edition,
  });
  if (
    authority.media.kind !== "movie" ||
    authority.media.id !== scope.mediaId ||
    (authority.scope.edition ?? "default") !== scope.edition ||
    binding.authority.binding.scope.mediaId !== scope.mediaId ||
    binding.authority.binding.scope.edition !== scope.edition
  )
    throw new Error(
      "Movie retention watch differs from its exact selected association",
    );
  const target = await watchAwait(
    execution,
    tx.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
      },
    }),
  );
  if (target.automationEpoch !== authority.runtime.recoveryEpoch) return true;
  if (target.editionRootId !== scope.rootMediaId)
    throw new Error("Movie retention target lineage changed");
  await watchAwait(
    execution,
    queueOperation(tx, {
      key: `movie-retention-v4:${scope.mediaId}:${scope.edition}:${String(target.generation)}:${bucket}`,
      kind: "retain_movie_edition_v4",
      targetId: scope.mediaId,
      payload: {
        schemaVersion: 4,
        scope,
        mediaId: scope.mediaId,
        generation: target.generation,
      },
    }),
  );
  return true;
}

/** Same current watch locks/deadline as ordinary queueing, with one explicit selected cut. */
export async function queueMovieRetentionCheck(
  context: MediaAutomationContext,
  selected: MovieEditionScope,
  bucket: string,
) {
  if (context.movieManagement === undefined)
    throw new Error(
      "Movie retention queue requires its original invocation budget",
    );
  const scope = MovieEditionScopeSchema.parse(selected);
  const execution = context.plexBindingExecution();
  const freshness = plexBindingFreshness({ ...execution, guards: [execution] });
  const active = { ...execution, assertActive: freshness.assertActive };
  await watchCheckpoint(active);
  const captured = await watchScope(
    context,
    scope.mediaId,
    { edition: scope.edition },
    active,
  );
  await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, captured, active);
    if (authority?.binding == null) return;
    const deadline = await watchDeadline(tx, authority, execution);
    await bindPlexTransactionDeadline(tx, deadline);
    if (
      !(await queueMovieRetentionFromWatch(tx, authority, bucket, {
        ...execution,
        assertActive: deadline.assertActive,
      }))
    )
      throw new Error(
        "Scoped movie polling cannot queue a historical default retention command",
      );
  });
}
