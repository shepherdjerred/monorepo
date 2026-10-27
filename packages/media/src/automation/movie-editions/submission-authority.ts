import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MediaError } from "#application/errors.ts";

/** A qBit mutation is never enclosed in an automatically retried transaction. */
export async function authorizedMovieSubmissionV4(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  scope: MovieEditionScope,
  effect: (signal: AbortSignal, beforeMutation: () => void) => Promise<void>,
) {
  const execution = context.plexBindingExecution();
  execution.assertActive();
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [scope.mediaId])) ?? {},
  );
  return context.db.$transaction(
    async (tx) => {
      await lockMovieCommand(tx, scope);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: [scope.mediaId],
      });
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
        return false;
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (
        current.state !== "submitting" ||
        current.coordinatorOperationId !== attempt.coordinatorOperationId
      )
        return false;
      const authorized = await movieAttemptEffectAuthorityV4(
        tx,
        current,
        scope,
        {
          access,
          ...(context.movieManagement === undefined
            ? {}
            : { invocation: context.movieManagement }),
        },
      );
      if (authorized === null || !(await context.gates.acquisition()))
        return false;
      const lease = await tx.legacyWriterLease.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const deadline = Math.min(
        lease.expiresAt.getTime(),
        execution.expiresAtMs,
      );
      const monotonicDeadline =
        execution.observed.monotonic + deadline - execution.observed.wall;
      const signal = AbortSignal.any([
        execution.signal,
        AbortSignal.timeout(10_000),
      ]);
      const beforeMutation = () => {
        execution.assertActive();
        signal.throwIfAborted();
        authorized.freshness.assertActive();
        if (
          Date.now() < lease.observedAt.getTime() ||
          Date.now() >= deadline ||
          performance.now() >= monotonicDeadline
        )
          throw new MediaError(
            "submission_authority_expired",
            "Original writer observation expired before torrent submission",
            409,
          );
      };
      beforeMutation();
      await effect(signal, beforeMutation);
      execution.assertActive();
      return true;
    },
    { timeout: 20_000 },
  );
}
