import { z } from "zod";
import type { Prisma, Operation } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MovieRollbackIntentV1Schema } from "#shared/movie-editions/rollback/physical.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { captureAutomaticMovieRollbackAuthorityV1 } from "./authority.ts";
import { readMovieRollbackIntentV1 } from "./records.ts";
import { readMovieRollbackRejectionPointerV1 } from "./rejection-records.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { movieRollbackTransactionId } from "./transaction.ts";
import { reserveMovieRollbackIntentSqlV1 } from "./read-budget.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";

function assertAutomaticRollbackCommand(
  command: Operation,
  source: MovieAttemptOperationV4,
) {
  if (
    !["reconcile_movie_edition_v4", "acquire_movie_edition_v4"].includes(
      command.kind,
    ) ||
    command.targetId !== source.scope.mediaId ||
    command.payload === null
  )
    throw new FileGuardError("movie_rollback_command_changed");
}

function originalAutomaticServing(
  pointer: Awaited<ReturnType<typeof readPlexPointer>>,
  input: {
    original: MoviePublicationAssetV2;
    source: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
  },
) {
  const { original, source, access } = input;
  const current = pointer.current;
  if (
    current?.association.schemaVersion !== 2 ||
    current.association.group.assetId !== original.id ||
    current.association.group.assetVersion !== original.version ||
    current.association.group.checksum !== original.checksum ||
    current.association.group.sizeBytes !== original.sizeBytes ||
    current.association.group.canonicalPath !== original.path ||
    current.association.group.ownershipEpoch !== original.ownershipEpoch ||
    current.association.group.canonicalRootId !== source.scope.rootMediaId ||
    current.association.access.serverMachineId !== access.serverMachineId ||
    current.association.access.sectionId !== access.movieSectionId ||
    current.association.access.sectionType !== "movie"
  )
    throw new FileGuardError("movie_rollback_original_serving_changed");
  return current;
}

/** A committed private admission precedes the first inverse syscall. */
export async function admitAutomaticMovieRollbackV1(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    source: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
  },
) {
  const { context, source, access } = input;
  const invocation = context.movieManagement;
  const owner = context.movieRollbackExecution;
  if (invocation === undefined || owner === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  const prior = await readMovieRollbackIntentV1(
    tx,
    { mode: "automatic_failed_plex", source },
    invocation.budget,
  );
  if (prior !== null) return prior;
  const publication = await loadMoviePublicationV2(
    tx,
    source.attemptId,
    invocation.budget,
  );
  if (
    publication?.outcome?.kind !== "published" ||
    publication.outcomeHash === null ||
    identityHash(publication.reference.intent.scope) !==
      identityHash(source.scope)
  )
    throw new FileGuardError("movie_rollback_source_not_published");
  const original = publication.reference.intent.entries[0].predecessor;
  const successor = publication.outcome.entries[0].successor;
  if (original === null || successor === null)
    throw new FileGuardError("movie_rollback_predecessor_missing");
  const captured = await captureAutomaticMovieRollbackAuthorityV1(tx, {
    ...input,
    assetIds: [original.id, successor.id],
    birthEpoch: publication.reference.intent.birthEpoch,
  });
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: source.operationId },
  });
  invocation.budget.consume(1);
  assertAutomaticRollbackCommand(command, source);
  const negative = await readMovieRollbackRejectionPointerV1(tx, {
    command,
    publication,
    source,
    budget: invocation.budget,
  });
  const successful = await tx.operation.findMany({
    where: {
      OR: ["moviePlexReceiptV2", "moviePlexReceiptV3"].map((marker) => ({
        AND: [
          {
            result: {
              path: [marker, "receipt", "input", "attemptId"],
              equals: source.attemptId,
            },
          },
          {
            result: {
              path: [marker, "receipt", "input", "scope"],
              equals: source.scope,
            },
          },
        ],
      })),
    },
    select: { id: true },
    take: invocation.budget.take,
  });
  invocation.budget.consume(successful.length);
  if (successful.length > 0)
    throw new FileGuardError(
      "movie_rollback_successful_plex_requires_manual_command",
    );
  const pointer = await readPlexPointer(
    tx,
    { mediaId: source.scope.mediaId, edition: source.scope.edition },
    invocation.budget,
  );
  const current = originalAutomaticServing(pointer, {
    original,
    source,
    access,
  });
  const pairCleanup = await tx.upgradeCleanup.findUnique({
    where: {
      assetId_successorAssetId: {
        assetId: original.id,
        successorAssetId: successor.id,
      },
    },
  });
  invocation.budget.consume(pairCleanup === null ? 0 : 1);
  if (pairCleanup !== null)
    throw new FileGuardError("movie_rollback_unexpected_verified_cleanup");
  const expectedA = publication.outcome.entries[0].predecessor;
  if (
    expectedA === null ||
    identityHash(expectedA) !== identityHash(captured.predecessor) ||
    identityHash(successor) !== identityHash(captured.successor)
  )
    throw new FileGuardError("movie_rollback_pair_changed");
  const part = current.association.item.media[0].parts[0];
  const intent = MovieRollbackIntentV1Schema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    transactionId: await movieRollbackTransactionId(tx),
    operationId: source.operationId,
    scope: source.scope,
    invocation: { mode: "automatic_failed_plex", source },
    command: {
      ...moviePlexCommandParentV2(command),
      payloadRaw: canonicalJson(z.json().parse(command.payload)),
    },
    source: {
      state: captured.attempt.state,
      reference: publication.reference,
      outcome: publication.outcome,
      outcomeHash: publication.outcomeHash,
      attemptHash: identityHash(moviePlexAttemptParentV2(captured.attempt)),
      attemptRaw: canonicalJson(moviePlexAttemptParentV2(captured.attempt)),
      commandHash: identityHash(moviePlexCommandParentV2(command)),
      commandRaw: canonicalJson(moviePlexCommandParentV2(command)),
      commandPayloadRaw: canonicalJson(z.json().parse(command.payload)),
    },
    rejection: negative,
    predecessor: captured.predecessor,
    successor: captured.successor,
    successorGrant: null,
    originalItem: {
      binding: current.snapshot,
      ratingKey: current.association.item.ratingKey,
      part: { id: part.id, file: part.file },
    },
    originalAccess: current.association.access,
    pointer: pointer.expected,
    access,
    authority: {
      generation: captured.authority.target.generation,
      recoveryEpoch: captured.attempt.recoveryEpoch,
      identityHash: identityHash(captured.attempt.identityEvidence),
      identityRaw: canonicalJson(
        z.json().parse(captured.attempt.identityEvidence),
      ),
      birthHash: identityHash({
        choiceId: captured.attempt.movieEditionChoiceId,
        choiceRevision: captured.attempt.movieEditionChoiceRevision,
        authority: captured.attempt.movieEditionAuthority,
      }),
      birthRaw: canonicalJson({
        choiceId: captured.attempt.movieEditionChoiceId,
        choiceRevision: captured.attempt.movieEditionChoiceRevision,
        authority: z.json().parse(captured.attempt.movieEditionAuthority),
      }),
      generationsHash: identityHash(captured.attempt.generations),
      generationsRaw: canonicalJson(
        z.json().parse(captured.attempt.generations),
      ),
      ...captured.profile,
    },
    cleanup: null,
    observedAt: new Date(context.execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(context.execution.expiresAtMs).toISOString(),
    expiresAt: new Date(captured.freshness.expiresAtMs).toISOString(),
    admittedAt: new Date().toISOString(),
    owner,
  });
  captured.freshness.assertActive();
  await bindPlexTransactionDeadline(tx, captured.freshness);
  const envelope = {
    intent: z.json().parse(intent),
    intentHash: identityHash(intent),
    raw: canonicalJson(z.json().parse(intent)),
  };
  reserveMovieRollbackIntentSqlV1(
    invocation.budget,
    captured.authority.identity.schemaVersion,
    intent,
  );
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackIntentV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${source.operationId} AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackIntentV1')`;
  if (updated !== 1)
    throw new Error(
      "Movie rollback admission changed under its actual command lock",
    );
  captured.freshness.assertActive();
  return { operation: command, intent, intentHash: envelope.intentHash };
}
