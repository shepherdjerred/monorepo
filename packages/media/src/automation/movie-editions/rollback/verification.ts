import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { readMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { captureMovieRollbackPlexExpectedV1 } from "#infrastructure/movie-editions/rollback/plex-expected.ts";
import { commitMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/plex-commit.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";
import { plexRead } from "#automation/publication/association/io.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieRollbackHandoffExecutionV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";

/** Only fresh verification of A's exact original ratingKey/Part can make it
 * available; a physical inverse alone cannot restore serving authority. */
export async function verifyRolledBackMoviePlexV4(
  base: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
  execution: PlexBindingExecution,
  takeover?: MovieRollbackHandoffExecutionV1,
): Promise<{
  status: "available" | "waiting" | "blocked" | "obsolete";
  reason: string | null;
}> {
  execution.assertActive();
  execution.signal.throwIfAborted();
  const initial = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const context = {
    ...initial,
    plexBindingExecution: () => execution,
    movieManagement: { ...initial.movieManagement, execution },
  };
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const invocation = context.movieManagement;
  const request = { mode: "automatic_failed_plex" as const, source: input };
  const historical = await readMovieRollbackPlexV1(
    context.db,
    request,
    invocation.budget,
  );
  execution.assertActive();
  if (historical !== null) return { status: "available", reason: null };
  try {
    if (!(await context.gates.acquisition()))
      return { status: "blocked", reason: "acquisition_disabled" };
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    const prepared = await context.db.$transaction((tx) =>
      captureMovieRollbackPlexExpectedV1(tx, {
        source: input,
        access,
        invocation,
        ...(takeover === undefined ? {} : { handoff: takeover }),
      }),
    );
    prepared.freshness.assertActive();
    await plexRead(
      { plex: context.plex, execution, freshness: prepared.freshness },
      () => context.plex.refresh(access.movieSectionId, execution.signal),
      "wrong_section",
    );
    const verified = await verifyMoviePlexV2(
      context,
      {
        purpose: "current_serving",
        expected: prepared.expected,
        canonicalTargets: prepared.canonicalTargets,
        access: prepared.expected.access,
        observed: execution.observed,
        expiresAtMs: prepared.freshness.expiresAtMs,
        guards: [prepared.freshness],
      },
      execution,
    );
    if ("status" in verified)
      return { status: "waiting", reason: verified.reason };
    const configured = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (identityHash(configured) !== identityHash(access))
      throw new PlexBindingProtection("wrong_section");
    await context.db.$transaction(
      async (tx) => {
        if (!(await context.gates.acquisition()))
          throw new PlexBindingProtection("scope_changed");
        await commitMovieRollbackPlexV1(tx, {
          source: input,
          access,
          expected: prepared.expected,
          verified,
          invocation,
          ...(takeover === undefined ? {} : { handoff: takeover }),
        });
        verified.freshness.assertActive();
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "available", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      !(error instanceof PlexBindingProtection) &&
      !(error instanceof MovieChoiceProtection)
    )
      throw error;
    return {
      status:
        error instanceof MovieChoiceProtection ||
        error.reason === "scope_changed" ||
        error.reason === "ownership_changed"
          ? "obsolete"
          : "waiting",
      reason:
        error instanceof MovieChoiceProtection ? error.code : error.reason,
    };
  }
}
