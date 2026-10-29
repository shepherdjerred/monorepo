import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieRemovalCompletionV4Schema,
  type MovieRemovalCompletionV4,
} from "#shared/movie-editions/removal-v4.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRemovalSourceV4 } from "#automation/movie-editions/notifications/removal-source.ts";
import { currentMovieRemovalV4 } from "#automation/movie-editions/notifications/removal-current.ts";
import { queueMovieRemovalNoticesV4 } from "#automation/movie-editions/notifications/removal-queue.ts";
import { serializable } from "#automation/store.ts";

const Completed = z.strictObject({
  input: MovieRemovalCompletionV4Schema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

/** Network-only post-effect completion. The physical producer and its immutable quarantine remain the source. */
export async function completeMovieRemovalV4(
  base: MediaAutomationContext,
  raw: MovieRemovalCompletionV4,
  execution: PlexBindingExecution,
): Promise<{ status: "completed" | "obsolete"; reason: string | null }> {
  execution.assertActive();
  const initial = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const context = {
    ...initial,
    plexBindingExecution: () => execution,
    movieManagement: { ...initial.movieManagement, execution },
  };
  const budget = context.movieManagement.budget;
  const input = MovieRemovalCompletionV4Schema.parse(raw);
  const source = await readMovieRemovalSourceV4(context.db, input, budget);
  const payload = Completed.parse({ input, sourceHash: source.sourceHash });
  const key = `movie-removal-completed-v4:${input.operationId}:${input.decisionId}:${input.stage}`;
  const prior = await context.db.applicationEvent.findUnique({
    where: { dedupeKey: key },
  });
  execution.assertActive();
  if (prior !== null) {
    if (
      prior.kind !== "movie_removal_completed_v4" ||
      identityHash(Completed.parse(prior.payload)) !== identityHash(payload)
    )
      throw new Error("Movie removal completion changed its literal source");
    return { status: "completed", reason: null };
  }
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  try {
    await serializable(context.db, async (tx) => {
      await lockMovieCommand(tx, input.scope);
      if (!(await lockRuntimeAuthority(tx, source.recoveryEpoch)))
        throw new PlexBindingProtection("ownership_changed");
      await tx.$queryRaw`SELECT id FROM "RetentionDecision" WHERE id=${input.decisionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR SHARE`;
      const current = await readMovieRemovalSourceV4(tx, input, budget);
      if (current.sourceHash !== source.sourceHash)
        throw new Error(
          "Movie removal completion source changed under its original locks",
        );
      if (
        !(await currentMovieRemovalV4(
          tx,
          { completion: input, source: current },
          budget,
        ))
      )
        throw new PlexBindingProtection("scope_changed");
      const lease = await tx.legacyWriterLease.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(execution.expiresAtMs, lease.expiresAt.getTime()),
        guards: [execution],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const guards = await queueMovieRemovalNoticesV4(
        tx,
        { completion: input, source: current, access },
        budget,
      );
      const configured = requireMovieChoiceAccess(
        (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
      );
      freshness.assertActive();
      if (identityHash(configured) !== identityHash(access))
        throw new PlexBindingProtection("wrong_section");
      await tx.applicationEvent.upsert({
        where: { dedupeKey: key },
        update: {},
        create: {
          dedupeKey: key,
          mediaId: input.scope.mediaId,
          kind: "movie_removal_completed_v4",
          payload,
        },
      });
      for (const guard of guards) guard.assertActive();
      freshness.assertActive();
    });
    execution.assertActive();
    return { status: "completed", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (!(error instanceof PlexBindingProtection)) throw error;
    return { status: "obsolete", reason: error.reason };
  }
}
