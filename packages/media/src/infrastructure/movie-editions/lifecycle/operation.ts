import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";

/** Validate the recorded coordinator, rather than interpreting an old unscoped command as v4. */
export async function assertMovieAcquisitionOperationV4(
  tx: Prisma.TransactionClient,
  operationId: string,
  rawScope: MovieEditionScope,
  epoch: number,
) {
  const scope = MovieEditionScopeSchema.parse(rawScope);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const { kind, recoveryEpoch, ...selected } = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.enum(["reconcile_movie_edition_v4", "acquire_movie_edition_v4"]),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const input = MovieOperationV4Schema.parse(selected);
  if (
    recoveryEpoch !== epoch ||
    operation.kind !== kind ||
    operation.id !== input.operationId ||
    operation.targetId !== scope.mediaId ||
    input.scope.rootMediaId !== scope.rootMediaId ||
    input.scope.mediaId !== scope.mediaId ||
    input.scope.edition !== scope.edition
  )
    throw new MediaError(
      "identity_scope_changed",
      "Acquisition coordinator differs from the requested movie edition",
      409,
    );
  if (
    operation.userId === null &&
    operation.kind === "acquire_movie_edition_v4"
  )
    throw new Error("Owner-selected v4 acquisition lost its actor");
  return { operation, input };
}
