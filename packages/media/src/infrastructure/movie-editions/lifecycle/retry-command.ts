import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieRetrySourceV4, captureMovieRetryV1 } from "./retry-source.ts";
import { movieRetryAuthorityV4 } from "./retry-authority.ts";

type Enqueue = (
  tx: Prisma.TransactionClient,
  command: {
    mediaId: string;
    generation: number;
    details: Prisma.InputJsonObject;
  },
) => Promise<string>;

/** Queue only. A running Workflow's generation, choice, reservation and coordinator stay untouched. */
export async function queueRequestedMovieRetryV4(
  tx: Prisma.TransactionClient,
  input: {
    actor: MediaActor;
    command: MovieLifecycleCommandV4;
    access: MovieChoiceAccess;
    budget: PublicationAuthorityReadBudget;
  },
  enqueue: Enqueue,
) {
  const { command, budget } = input;
  if (command.command.action !== "retry")
    throw new MediaError(
      "invalid_movie_retry",
      "This command retries one existing movie acquisition",
      422,
    );
  const { media, target } = await lockMovieCommand(tx, command.scope);
  if (
    media.version !== command.expected.mediaVersion ||
    target?.version !== command.expected.targetVersion
  )
    throw new MediaError(
      "version_conflict",
      "Movie target changed; review before retrying",
      409,
    );
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: [command.scope.mediaId],
  });
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: {
        mediaId: command.scope.mediaId,
        edition: command.scope.edition,
      },
    },
  });
  if (reservation === null)
    throw new MediaError(
      "movie_retry_attempt_required",
      "Movie retry requires its current recorded acquisition",
      409,
    );
  const source = await readMovieRetrySourceV4(
    tx,
    { attemptId: reservation.attemptId, scope: command.scope },
    budget,
  );
  if (!(await lockRuntimeAuthority(tx, source.attempt.recoveryEpoch)))
    throw new MediaError(
      "intent_ownership_unconfirmed",
      "Movie acquisition belongs to an inactive recovery epoch",
      409,
    );
  const freshness = await movieRetryAuthorityV4(tx, {
    scope: command.scope,
    source,
    access: input.access,
    actorId: input.actor.id,
    budget,
  });
  await assertNoPendingMovieRetryV4(tx, source, budget);
  const operationId = await enqueue(tx, {
    mediaId: command.scope.mediaId,
    generation: source.generation,
    details: {
      schemaVersion: 4,
      scope: command.scope,
      movieRetryV1: captureMovieRetryV1(source, "manual"),
    },
  });
  freshness.assertActive();
  return {
    operationId,
    freshness,
    applied: { mediaVersion: media.version, targetVersion: target.version },
  };
}

export async function assertNoPendingMovieRetryV4(
  tx: Prisma.TransactionClient,
  source: Awaited<ReturnType<typeof readMovieRetrySourceV4>>,
  budget: PublicationAuthorityReadBudget,
) {
  const pending = await tx.operation.findMany({
    where: {
      kind: "reconcile_movie_edition_v4",
      status: { in: ["queued", "running"] },
      AND: [
        {
          payload: {
            path: ["movieRetryV1", "attemptId"],
            equals: source.attempt.id,
          },
        },
        {
          payload: {
            path: ["movieRetryV1", "previousCoordinatorOperationId"],
            equals: source.operation.id,
          },
        },
      ],
    },
    take: 2,
  });
  budget.consume(pending.length);
  if (pending.length > 0)
    throw new MediaError(
      "movie_retry_pending",
      "This exact movie acquisition already has a pending retry",
      409,
    );
}
