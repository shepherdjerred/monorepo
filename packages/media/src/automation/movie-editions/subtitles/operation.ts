import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieSubtitleOperationV4Schema,
  type MovieSubtitleOperationV4,
} from "#shared/movie-editions/subtitles-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

export async function assertMovieSubtitleOperationV4(
  tx: Prisma.TransactionClient,
  input: MovieSubtitleOperationV4,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const { kind, ...recorded } = z
    .object({
      ...MovieSubtitleOperationV4Schema.shape,
      kind: z.literal("acquire_movie_subtitles_v4"),
    })
    .parse(operation.payload);
  if (
    operation.kind !== kind ||
    operation.targetId !== input.assetId ||
    identityHash(z.json().parse(recorded)) !==
      identityHash(z.json().parse(input))
  )
    throw new FileGuardError("subtitle_operation_changed");
  return operation;
}
