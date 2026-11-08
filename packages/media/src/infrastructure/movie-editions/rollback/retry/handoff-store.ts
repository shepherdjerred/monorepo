import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieRollbackHandoffV1Schema } from "#shared/movie-editions/rollback/handoff.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { observeMovieRollbackClosedOwnerV1 } from "#automation/movie-editions/rollback/closed-owner.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { movieRollbackTransactionId } from "#infrastructure/movie-editions/rollback/transaction.ts";
import type { readMovieRollbackRetryCommandV1 } from "./retry-command-records.ts";
import type {
  captureMovieRollbackRetryContextV1,
  MovieRollbackRetryParentV1,
  MovieRollbackRetryInvocationV1,
} from "./retry-context.ts";
import { requestedMovieRollbackConflict } from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";

type Closed = Extract<
  Awaited<ReturnType<typeof observeMovieRollbackClosedOwnerV1>>,
  { state: "closed" }
>;

/** Original Operation lock and complete current pair locks belong to caller.
 * One event grants only this real new run; no old admission is recreated. */
export async function grantMovieRollbackOwnerV1(
  tx: Prisma.TransactionClient,
  input: {
    parent: MovieRollbackRetryParentV1;
    command: Awaited<ReturnType<typeof readMovieRollbackRetryCommandV1>>;
    captured: Awaited<ReturnType<typeof captureMovieRollbackRetryContextV1>>;
    invocation: MovieRollbackRetryInvocationV1;
    owner: MovieRollbackExecution;
    closed: Closed;
    freshness: PlexBindingFreshness;
    writerExpiresAtMs: number;
  },
) {
  const { parent, command, captured, invocation, owner, closed } = input;
  const previousOwner = captured.handoff?.handoff.owner ?? parent.intent.owner;
  if (
    owner.workflowId !== `media-operation-${command.operation.id}` ||
    owner.runId === previousOwner.runId ||
    closed.owner.workflowId !== previousOwner.workflowId ||
    closed.owner.runId !== previousOwner.runId ||
    identityHash(captured.expected) !==
      identityHash(command.payload.retry.expected)
  )
    throw requestedMovieRollbackConflict(
      "The exact prior owner, current pair or new Workflow changed before handoff",
    );
  const raw = (value: unknown) => canonicalJson(z.json().parse(value));
  const handoff = MovieRollbackHandoffV1Schema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    transactionId: await movieRollbackTransactionId(tx),
    operationId: parent.operation.id,
    intentId: parent.intent.id,
    intentHash: parent.intentHash,
    scope: parent.intent.scope,
    input: command.input,
    commandHash: identityHash(command.operation.payload),
    commandRaw: raw(command.operation.payload),
    actorId: command.operation.userId,
    expected: captured.expected,
    predecessor: captured.predecessor,
    predecessorRaw: raw(captured.predecessor),
    successor: captured.successor,
    successorRaw: raw(captured.successor),
    previous: captured.handoff?.reference ?? null,
    previousOwner,
    closedOwner: closed.owner,
    closedSourceRoot: closed.sourceRoot,
    owner,
    observedAt: new Date(invocation.execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(invocation.execution.expiresAtMs).toISOString(),
    writerExpiresAt: new Date(input.writerExpiresAtMs).toISOString(),
    expiresAt: new Date(input.freshness.expiresAtMs).toISOString(),
    grantedAt: new Date().toISOString(),
  });
  const captions =
    handoff.predecessor.subtitles.length +
    handoff.predecessor.subtitleHistory.length +
    handoff.successor.subtitles.length +
    handoff.successor.subtitleHistory.length;
  // Actual original/retry Ops, media/target/runtime/profile/pointer; A/B rows
  // and coverage, full caption union, actor+mapping, original cleanup, prior
  // handoff when present, and two same-transaction event-pointer validations.
  invocation.budget.consume(
    16 +
      captions +
      (handoff.expected.originalCleanup === null ? 0 : 1) +
      (handoff.previous === null ? 0 : 1),
  );
  const freshness = input.freshness;
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  const handoffHash = identityHash(handoff);
  const reference = { eventId: handoff.id, handoffHash };
  await tx.applicationEvent.create({
    data: {
      id: handoff.id,
      kind: "movie_rollback_owner_handoff_v1",
      mediaId: handoff.scope.mediaId,
      actorId: handoff.actorId,
      dedupeKey: `movie-rollback-owner-v1:${handoff.id}`,
      createdAt: new Date(),
      payload: {
        handoff: z.json().parse(handoff),
        handoffHash,
        raw: raw(handoff),
      },
    },
  });
  const previous =
    handoff.previous === null ? null : JSON.stringify(handoff.previous);
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackOwnerV1',${JSON.stringify(reference)}::jsonb)
    WHERE id=${parent.operation.id} AND result#>>'{movieRollbackIntentV1,intentHash}'=${parent.intentHash}
    AND result->'movieRollbackOwnerV1' IS NOT DISTINCT FROM ${previous}::jsonb`;
  if (changed !== 1)
    throw requestedMovieRollbackConflict(
      "The original rollback acquired another execution owner",
    );
  const assigned =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackHandoffV1',${JSON.stringify(reference)}::jsonb)
    WHERE id=${command.operation.id} AND payload=${JSON.stringify(command.operation.payload)}::jsonb AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackHandoffV1')`;
  if (assigned !== 1)
    throw requestedMovieRollbackConflict(
      "The retry command already belongs to another actual run",
    );
  freshness.assertActive();
  return { handoff, reference };
}
