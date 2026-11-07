import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MovieRollbackHandoffRefV1Schema } from "#shared/movie-editions/rollback/handoff-reference.ts";
import {
  MovieRollbackHandoffV1Schema,
  type MovieRollbackHandoffV1,
} from "#shared/movie-editions/rollback/handoff.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { assertMovieRollbackCanonical } from "#infrastructure/movie-editions/rollback/canonical.ts";
import { readMovieRollbackRetryCommandV1 } from "./retry-command-records.ts";
import type { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";

type MovieRollbackRetryParentV1 = NonNullable<
  Awaited<ReturnType<typeof readMovieRollbackIntentV1>>
>;

/** One immutable immediate handoff, whose birth closed previous-owner ancestry.
 * The supplied original Operation must have been queried in this transaction. */
export async function readMovieRollbackHandoffV1(
  tx: Prisma.TransactionClient,
  parent: MovieRollbackRetryParentV1,
  budget: PublicationAuthorityReadBudget,
) {
  const raw = z
    .object({
      movieRollbackOwnerV1: MovieRollbackHandoffRefV1Schema.optional(),
    })
    .nullable()
    .parse(parent.operation.result)?.movieRollbackOwnerV1;
  if (raw === undefined) return null;
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: raw.eventId },
  });
  budget.consume(1);
  const envelope = z
    .strictObject({
      handoff: z.json(),
      handoffHash: z.string(),
      raw: z.string(),
    })
    .parse(event.payload);
  const handoff = parsePlexRecord(
    MovieRollbackHandoffV1Schema,
    envelope.handoff,
    envelope.handoffHash,
  );
  assertMovieRollbackCanonical(envelope.raw, handoff, envelope.handoffHash);
  const command = await readMovieRollbackRetryCommandV1(
    tx,
    handoff.input,
    budget,
  );
  if (
    raw.handoffHash !== envelope.handoffHash ||
    event.id !== handoff.id ||
    event.kind !== "movie_rollback_owner_handoff_v1" ||
    event.mediaId !== parent.intent.scope.mediaId ||
    event.actorId !== command.operation.userId ||
    event.dedupeKey !== `movie-rollback-owner-v1:${handoff.id}`
  )
    throw new Error("Movie rollback handoff lost its actual immutable event");
  assertHandoffBindings(handoff, parent, command);
  assertMovieRollbackCanonical(
    handoff.commandRaw,
    command.operation.payload,
    handoff.commandHash,
  );
  assertMovieRollbackCanonical(
    handoff.predecessorRaw,
    handoff.predecessor,
    handoff.expected.predecessor.snapshotHash,
  );
  assertMovieRollbackCanonical(
    handoff.successorRaw,
    handoff.successor,
    handoff.expected.successor.snapshotHash,
  );
  return { event, handoff, reference: raw, command };
}

function assertHandoffBindings(
  handoff: MovieRollbackHandoffV1,
  parent: MovieRollbackRetryParentV1,
  command: Awaited<ReturnType<typeof readMovieRollbackRetryCommandV1>>,
) {
  if (
    handoff.actorId !== command.operation.userId ||
    handoff.operationId !== parent.operation.id ||
    handoff.intentId !== parent.intent.id ||
    handoff.intentHash !== parent.intentHash ||
    identityHash(handoff.scope) !== identityHash(parent.intent.scope) ||
    handoff.commandHash !== identityHash(command.operation.payload) ||
    identityHash(handoff.expected) !==
      identityHash(command.payload.retry.expected) ||
    identityHash(command.payload.source) !==
      identityHash(parent.intent.invocation.source) ||
    identityHash(command.payload.invocation) !==
      identityHash(parent.intent.invocation) ||
    handoff.input.resume.operationId !== parent.operation.id ||
    handoff.input.resume.intentHash !== parent.intentHash
  )
    throw new Error(
      "Movie rollback handoff lost its actual immutable owner command",
    );
  if (
    handoff.owner.workflowId !== `media-operation-${command.operation.id}` ||
    handoff.closedOwner.workflowId !== handoff.previousOwner.workflowId ||
    handoff.closedOwner.runId !== handoff.previousOwner.runId ||
    (handoff.previous === null &&
      identityHash(handoff.previousOwner) !== identityHash(parent.intent.owner))
  )
    throw new Error(
      "Movie rollback handoff lost its actual immutable owner command or previous run",
    );
}
