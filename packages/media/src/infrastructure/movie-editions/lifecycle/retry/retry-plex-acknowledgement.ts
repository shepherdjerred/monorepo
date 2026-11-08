import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieRetryPlexAcknowledgementV1Schema,
  type MovieRetryPlexCaptureV1Schema,
} from "#shared/movie-editions/retry/v2.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";

export function readMovieRetryPlexAcknowledgementV1(
  raw: unknown,
  command: MovieOperationV4,
  capture: z.infer<typeof MovieRetryPlexCaptureV1Schema>,
) {
  const marker = z
    .object({ movieRetryPlexAcknowledgementV1: z.unknown().optional() })
    .nullable()
    .parse(raw)?.movieRetryPlexAcknowledgementV1;
  if (marker === undefined) return null;
  const proof = MovieRetryPlexAcknowledgementV1Schema.parse(marker);
  if (
    identityHash(proof.command) !== identityHash(command) ||
    identityHash(proof.originalInput) !== identityHash(capture.originalInput) ||
    proof.originalReceiptHash !== capture.originalReceiptHash ||
    proof.originalCommandHash !== capture.originalCommandHash
  )
    throw new Error(
      "Movie historical retry acknowledgement changed its original source selection",
    );
  return proof;
}

export async function commitMovieRetryPlexAcknowledgementV1(
  tx: Prisma.TransactionClient,
  input: {
    proof: z.infer<typeof MovieRetryPlexAcknowledgementV1Schema>;
    capture: z.infer<typeof MovieRetryPlexCaptureV1Schema>;
  },
  budget: PublicationAuthorityReadBudget,
  execution: Pick<PlexBindingExecution, "assertActive">,
) {
  execution.assertActive();
  const proof = MovieRetryPlexAcknowledgementV1Schema.parse(input.proof);
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${proof.command.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: proof.command.operationId },
  });
  budget.consume(1);
  execution.assertActive();
  const previous = readMovieRetryPlexAcknowledgementV1(
    operation.result,
    proof.command,
    input.capture,
  );
  if (previous !== null) return previous;
  await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRetryPlexAcknowledgementV1',${JSON.stringify(proof)}::jsonb) WHERE id=${operation.id}`;
  execution.assertActive();
  return proof;
}
