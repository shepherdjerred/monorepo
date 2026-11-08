import type { MediaAutomationContext } from "#automation/context.ts";
import { z } from "zod";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieRollbackOperationV1Schema,
  type MovieRollbackOperationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { MediaError } from "#application/errors.ts";
import { readRequestedMovieRollbackCommandV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command-records.ts";
import { readMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { captureRequestedMovieRollbackPlexExpectedV1 } from "#infrastructure/movie-editions/rollback/manual/manual-plex-expected.ts";
import { commitMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/plex-commit.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";
import { plexRead } from "#automation/publication/association/io.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieRollbackHandoffExecutionV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";

export async function verifyRequestedMovieRollbackV1(
  base: MediaAutomationContext,
  raw: MovieRollbackOperationV1,
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
  const input = MovieRollbackOperationV1Schema.parse(raw);
  const invocation = context.movieManagement;
  const command = await readRequestedMovieRollbackCommandV1(
    context.db,
    input,
    invocation.budget,
  );
  const completed = z
    .object({ movieRollbackPlexV1: z.unknown().optional() })
    .nullable()
    .parse(command.operation.result)?.movieRollbackPlexV1;
  // The actual queried command selects only a completed-history read. Pending
  // publication is fully reproved in both current captures under their locks.
  const historical =
    completed === undefined
      ? null
      : await readMovieRollbackPlexV1(
          context.db,
          { mode: "manual_verified", command: input, source: command.source },
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
      captureRequestedMovieRollbackPlexExpectedV1(tx, {
        command: input,
        access,
        invocation,
        ...(takeover === undefined ? {} : { handoff: takeover }),
      }),
    );
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
          source: command.source,
          manualCommand: input,
          ...(takeover === undefined ? {} : { handoff: takeover }),
          access,
          expected: prepared.expected,
          verified,
          invocation,
        });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "available", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (error instanceof MediaError)
      return { status: "obsolete", reason: error.code };
    if (error instanceof PlexBindingProtection)
      return { status: "waiting", reason: error.reason };
    throw error;
  }
}
