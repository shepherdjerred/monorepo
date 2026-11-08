import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { admitAutomaticMovieRollbackV1 } from "#infrastructure/movie-editions/rollback/admission.ts";
import { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";

/** Durable admission is one actual Activity. It owns no inverse filesystem
 * effects; the later physical Activity receives its own entry capability. */
export async function prepareMovieRollbackV4(
  base: FileContext,
  raw: MovieAttemptOperationV4,
): Promise<{ status: "prepared" | "blocked"; reason: string | null }> {
  const execution = requirePublicationExecution(base.publicationExecution?.());
  const source = MovieAttemptOperationV4Schema.parse(raw);
  if (base.movieManagement === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const context = publicationInvocation(base, execution);
  const historical = await readMovieRollbackIntentV1(
    base.db,
    { mode: "automatic_failed_plex", source },
    base.movieManagement.budget,
  );
  execution.assertActive();
  if (historical !== null) return { status: "prepared", reason: null };
  try {
    if (!(await base.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const access = requireMovieChoiceAccess(
      (await fileMovieAccess(base, [source.scope.mediaId])) ?? {},
    );
    await base.db.$transaction(
      (tx) => admitAutomaticMovieRollbackV1(tx, { context, source, access }),
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "prepared", reason: null };
  } catch (error) {
    execution.assertActive();
    if (!(error instanceof FileGuardError)) throw error;
    return { status: "blocked", reason: error.reason };
  }
}
