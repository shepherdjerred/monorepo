import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { recordMoviePlexRejectionV1 } from "#infrastructure/movie-editions/rollback/rejection.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** New Activity protocol only. The actual existing serving verifier supplies
 * each negative parent; exceptions never become rejection receipts. */
export async function publishMovieWithRollbackV4(
  base: MediaAutomationContext,
  input: MovieAttemptOperationV4,
  execution: PlexBindingExecution,
) {
  const initial = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const context = {
    ...initial,
    movieManagement: { ...initial.movieManagement, execution },
  };
  execution.assertActive();
  return publishMoviePlexV4(context, input, execution, async (rejected) => {
    const currentAccess = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (identityHash(currentAccess) !== identityHash(rejected.access))
      throw new PlexBindingProtection("wrong_section");
    await context.db.$transaction(
      async (tx) => {
        if (!(await context.gates.acquisition()))
          throw new PlexBindingProtection("scope_changed");
        await recordMoviePlexRejectionV1(tx, {
          source: input,
          ...rejected,
          invocation: context.movieManagement,
        });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
  });
}
