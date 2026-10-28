import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MediaError } from "#application/errors.ts";
import {
  readMovieRetrySourceV4,
  captureMovieRetryV1,
} from "#infrastructure/movie-editions/lifecycle/retry-source.ts";
import { movieRetryAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/retry-authority.ts";
import { assertNoPendingMovieRetryV4 } from "#infrastructure/movie-editions/lifecycle/retry-command.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { movieRetryTerminalV1 } from "./terminal.ts";

/** Real movie identity selects this route for default and named attempts; ordinary recovery remains literal. */
export async function queueTerminalMovieRetryV4(
  context: MediaAutomationContext,
  input: { attemptId: string; scope: MovieEditionScope },
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie retry sweep requires its original invocation and allowance",
    );
  const { execution, budget } = invocation;
  execution.assertActive();
  try {
    const source = await readMovieRetrySourceV4(context.db, input, budget);
    const terminal = await movieRetryTerminalV1(
      context,
      {
        attemptId: source.attempt.id,
        previousCoordinatorOperationId: source.operation.id,
        reservedWithoutTorrent:
          source.state === "reserved" && source.attempt.torrent === null,
      },
      execution,
    );
    if (terminal === null) return;
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    execution.assertActive();
    await serializable(context.db, async (tx) => {
      await lockMovieCommand(tx, input.scope);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: [input.scope.mediaId],
      });
      if (!(await lockRuntimeAuthority(tx, source.attempt.recoveryEpoch)))
        return;
      const current = await readMovieRetrySourceV4(tx, input, budget);
      const capture = captureMovieRetryV1(current, "automatic");
      if (
        identityHash(capture) !==
        identityHash(captureMovieRetryV1(source, "automatic"))
      )
        return;
      const authority = await movieRetryAuthorityV4(tx, {
        scope: input.scope,
        source: current,
        access,
        invocation,
        budget,
      });
      await assertNoPendingMovieRetryV4(tx, current, budget);
      const lease = await tx.legacyWriterLease.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          execution.expiresAtMs,
          lease.expiresAt.getTime(),
          authority.expiresAtMs,
        ),
        guards: [execution, authority],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const configured = requireMovieChoiceAccess(
        (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
      );
      freshness.assertActive();
      if (identityHash(configured) !== identityHash(access))
        throw new MediaError(
          "plex_scope_unconfigured",
          "Movie retry configured library changed",
          409,
        );
      await queueOperation(tx, {
        key: `movie-retry-recover-v4:${source.attempt.id}:${source.operation.id}:${terminal.root.runId}:${terminal.child?.runId ?? "unstarted"}`,
        kind: "reconcile_movie_edition_v4",
        targetId: input.scope.mediaId,
        payload: {
          schemaVersion: 4,
          scope: input.scope,
          mediaId: input.scope.mediaId,
          generation: current.generation,
          movieRetryV1: capture,
        },
      });
      freshness.assertActive();
    });
    execution.assertActive();
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (!(error instanceof MediaError)) throw error;
  }
}
