import { z } from "zod";
import type { Prisma, Operation } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MoviePlexRejectionV1Schema,
  MoviePlexRejectionEnvelopeV1Schema,
  type MoviePlexRejectionV1,
} from "#shared/movie-editions/rollback/rejection.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";
import { assertMovieRollbackAttemptBytesV1 } from "./parent-bytes.ts";

export async function readMovieRollbackRejectionPointerV1(
  tx: Prisma.TransactionClient,
  input: {
    command: Operation;
    publication: NonNullable<
      Awaited<ReturnType<typeof loadMoviePublicationV2>>
    >;
    source: MovieAttemptOperationV4;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const negative = z
    .object({
      movieRollbackRejectionV1: z
        .strictObject({ eventId: z.uuid(), receiptHash: z.string() })
        .optional(),
    })
    .nullable()
    .parse(input.command.result)?.movieRollbackRejectionV1;
  if (negative === undefined)
    throw new FileGuardError("movie_rollback_actual_plex_rejection_missing");
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: negative.eventId },
  });
  input.budget.consume(1);
  const rejection = parseMoviePlexRejectionV1({
    event,
    source: input.publication,
    command: input.command,
    expectedInput: input.source,
  });
  if (rejection.receiptHash !== negative.receiptHash)
    throw new Error("Movie rollback rejected observation pointer changed");
  return negative;
}

export function assertRejectionClock(receipt: MoviePlexRejectionV1) {
  const observed = Date.parse(receipt.sdk.observedAt),
    completed = Date.parse(receipt.completedAt),
    expires = Date.parse(receipt.expiresAt);
  if (
    completed < observed ||
    completed >= expires ||
    expires >
      Math.min(
        observed + 60_000,
        Date.parse(receipt.sdk.expiresAt),
        Date.parse(receipt.writerExpiresAt),
      )
  )
    throw new Error(
      "Movie rejected Plex observation changed its original execution deadline",
    );
}

/** Historical rejection readers never import or instantiate a current verifier. */
export function parseMoviePlexRejectionV1(input: {
  event: { id: string; kind: string; mediaId: string | null; payload: unknown };
  source: NonNullable<Awaited<ReturnType<typeof loadMoviePublicationV2>>>;
  command: Operation;
  expectedInput: MovieAttemptOperationV4;
}) {
  const envelope = MoviePlexRejectionEnvelopeV1Schema.parse(
    input.event.payload,
  );
  assertMovieRollbackCanonical(
    envelope.raw,
    envelope.receipt,
    envelope.receiptHash,
  );
  const receipt = parsePlexRecord(
    MoviePlexRejectionV1Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  assertMovieRollbackAttemptBytesV1(
    input.source.attempt,
    receipt,
    receipt.attempt,
  );
  assertMovieRollbackCanonical(
    receipt.commandPayloadRaw,
    input.command.payload,
    receipt.command.payloadHash,
  );
  if (
    input.event.kind !== "movie_plex_rejected_v1" ||
    input.event.id !== receipt.id ||
    input.event.mediaId !== receipt.input.scope.mediaId ||
    identityHash(receipt.input) !== identityHash(input.expectedInput) ||
    identityHash(receipt.command) !==
      identityHash(moviePlexCommandParentV2(input.command)) ||
    identityHash(receipt.attempt) !==
      identityHash(moviePlexAttemptParentV2(input.source.attempt)) ||
    identityHash(receipt.publication) !==
      identityHash({
        transitionId: input.source.reference.transitionId,
        intentHash: input.source.reference.intentHash,
        outcomeHash: input.source.outcomeHash,
      })
  )
    throw new Error(
      "Movie rollback rejected Plex parent changed its actual source",
    );
  assertRejectionClock(receipt);
  return { receipt, receiptHash: envelope.receiptHash };
}
