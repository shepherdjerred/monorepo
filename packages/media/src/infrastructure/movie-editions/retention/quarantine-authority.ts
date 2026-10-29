import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  RemovalPlanSchema,
  type RemovalEntry,
} from "#automation/files/types.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";

export function movieQuarantineManifest(input: {
  plan: RemovalEntry[];
  scope: MovieEditionScope;
  access: readonly PlexAccess[];
}) {
  const manifest = { assets: input.plan };
  const parsed = RemovalPlanSchema.parse(manifest);
  const entry = input.plan[0];
  const access = input.access[0];
  if (
    entry?.libraryKind !== "movies" ||
    input.plan.length !== 1 ||
    access?.sectionType !== "movie" ||
    input.access.length !== 1 ||
    identityHash(parsed) !== identityHash(manifest) ||
    identityHash(entry.mediaIds) !== identityHash([input.scope.mediaId])
  )
    throw new PlexBindingProtection("scope_changed");
  return { manifest, entry, access };
}

/** Operational authority is reread under the caller's final physical locks. */
export async function movieQuarantineAuthority(
  tx: Prisma.TransactionClient,
  input: { operationId: string; decisionId: string; scope: MovieEditionScope },
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const payload = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.literal("retain_movie_edition_v4"),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
    include: { plexProjection: true },
  });
  budget.consume(1 + (decision.plexProjection === null ? 0 : 1));
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  budget.consume(3);
  const epoch = z
    .object({ recoveryEpoch: z.int().nonnegative() })
    .parse(decision.evidence).recoveryEpoch;
  if (
    operation.kind !== payload.kind ||
    operation.targetId !== input.scope.mediaId ||
    payload.operationId !== operation.id ||
    payload.mediaId !== input.scope.mediaId ||
    identityHash(payload.scope) !== identityHash(input.scope) ||
    input.scope.rootMediaId !== media.id ||
    media.kind !== "movie" ||
    decision.mediaId !== input.scope.mediaId ||
    decision.edition !== input.scope.edition ||
    decision.generation !== payload.generation ||
    target.generation !== payload.generation ||
    target.editionRootId !== input.scope.rootMediaId ||
    target.automationEpoch !== epoch ||
    payload.recoveryEpoch !== epoch ||
    runtime.recoveryEpoch !== epoch ||
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed
  )
    throw new PlexBindingProtection("scope_changed");
  return { operation, decision, epoch };
}

export function assertNoMovieQuarantineReceipt(result: unknown) {
  if (
    z
      .object({ movieQuarantinePlexReceiptV2: z.unknown().optional() })
      .nullable()
      .parse(result)?.movieQuarantinePlexReceiptV2 !== undefined
  )
    throw new PlexBindingProtection("scope_changed");
}
