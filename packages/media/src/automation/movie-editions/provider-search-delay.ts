import { queueOperation, serializable } from "#automation/store.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { movieManagementContext } from "./management-context.ts";

/** A scheduled movie search reconsiders the whole edition, so one wakeup covers its delayed listings. */
export async function queueMovieSearchDelay(
  context: ReturnType<typeof movieManagementContext>,
  scope: MovieEditionScope,
  input: {
    profile: { id: string; version: number };
    generation: number | undefined;
    eligibleAt: Date;
  },
) {
  const { profile, eligibleAt } = input;
  context.movieManagement.budget.consume(2);
  await serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, scope);
    if (
      target === null ||
      (input.generation !== undefined &&
        target.generation !== input.generation) ||
      target.profileId !== profile.id
    )
      return;
    context.movieManagement.execution.assertActive();
    await queueOperation(tx, {
      key: `provider-delay:movie-search:${scope.mediaId}:${scope.edition}:${String(target.generation)}:${profile.id}:${String(profile.version)}:${String(eligibleAt.getTime())}`,
      kind: "reconcile_movie_edition_v4",
      targetId: scope.mediaId,
      payload: {
        schemaVersion: 4,
        scope,
        mediaId: scope.mediaId,
        generation: target.generation,
      },
      availableAt: eligibleAt,
    });
  });
}
