import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { z } from "zod";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** An old pending v3 selection is activated only by an actual v4 coordinator for that declaration. */
export async function movieChoiceActivationRequiredV4(
  tx: Prisma.TransactionClient,
  request: {
    id: string;
    version: number;
    active: boolean;
    choiceId: string | null;
    scope: MovieEditionScope;
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (!request.active || request.choiceId === null) return false;
  const command = await tx.operation.findFirst({
    where: {
      targetId: request.scope.mediaId,
      kind: { in: ["reconcile_movie_edition_v4", "restore_movie_edition_v4"] },
      AND: [
        { payload: { path: ["schemaVersion"], equals: 4 } },
        {
          payload: {
            path: ["scope", "edition"],
            equals: request.scope.edition,
          },
        },
        { payload: { path: ["requestId"], equals: request.id } },
        { payload: { path: ["requestVersion"], equals: request.version } },
      ],
    },
  });
  if (command === null) return true;
  budget.consume(1);
  const source = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.enum(["reconcile_movie_edition_v4", "restore_movie_edition_v4"]),
      requestId: z.uuid(),
      requestVersion: z.int().nonnegative(),
    })
    .parse(command.payload);
  if (
    command.id !== source.operationId ||
    command.kind !== source.kind ||
    command.targetId !== request.scope.mediaId ||
    source.mediaId !== request.scope.mediaId ||
    identityHash(source.scope) !== identityHash(request.scope) ||
    source.requestId !== request.id ||
    source.requestVersion !== request.version
  )
    throw new Error(
      "Movie activation history differs from its exact declaration source",
    );
  return false;
}
