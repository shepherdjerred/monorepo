import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MovieRollbackIntentV1Schema } from "#shared/movie-editions/rollback/physical.ts";
import type { MovieRollbackCaptionManifestV1 } from "#shared/movie-editions/rollback/captions.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertRollbackOriginalEvidence } from "#infrastructure/movie-editions/rollback/records.ts";
import { movieRollbackTransactionId } from "#infrastructure/movie-editions/rollback/transaction.ts";
import type { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";
import type { captureRequestedMovieRollbackContextV1 } from "./manual-context.ts";
import type { captureRequestedMovieRollbackFilesAuthorityV1 } from "./manual-authority.ts";
import { reserveRequestedMovieRollbackIntentSqlV1 } from "./manual-read-budget.ts";

/** Called after complete SQL+native locks and fresh playback. The pending
 * cleanup cancellation is exact and cannot renew the original A/B window. */
export async function admitRequestedMovieRollbackV1(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    command: Awaited<ReturnType<typeof readRequestedMovieRollbackCommandV1>>;
    captured: Awaited<
      ReturnType<typeof captureRequestedMovieRollbackContextV1>
    >;
    authority: Awaited<
      ReturnType<typeof captureRequestedMovieRollbackFilesAuthorityV1>
    >;
    access: MovieChoiceAccess;
    captions: MovieRollbackCaptionManifestV1;
  },
) {
  const { context, command, captured, authority } = input;
  const invocation = context.movieManagement;
  const owner = context.movieRollbackExecution;
  if (invocation === undefined || owner === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  if (
    input.captions.assetId !== captured.successor.id ||
    identityHash(captured.context.expected) !== identityHash(command.expected)
  )
    throw new FileGuardError("movie_rollback_review_changed");
  const original = captured.published.reference.intent.entries[0].predecessor;
  const previous = captured.serving.expected.previous[0];
  if (previous === undefined)
    throw new Error("Verified movie upgrade lost its original serving scope");
  if (original === null || previous.evidence === null)
    throw new Error("Verified movie upgrade lost its original serving parent");
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: previous.evidence.id },
  });
  invocation.budget.consume(1);
  const association = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    evidence.evidence,
    previous.evidence.associationHash,
  );
  const sourceCommand = await tx.operation.findUniqueOrThrow({
    where: { id: captured.source.operationId },
  });
  invocation.budget.consume(1);
  const attempt = captured.published.attempt;
  const part = association.item.media[0].parts[0];
  const intent = MovieRollbackIntentV1Schema.parse({
    schemaVersion: 1,
    id: input.captions.admissionId,
    transactionId: await movieRollbackTransactionId(tx),
    operationId: command.operation.id,
    scope: captured.source.scope,
    invocation: {
      mode: "manual_verified",
      command: {
        schemaVersion: 1,
        operationId: command.operation.id,
        sourceAttemptId: captured.source.attemptId,
        scope: captured.source.scope,
      },
      source: captured.source,
    },
    command: {
      ...moviePlexCommandParentV2(command.operation),
      payloadRaw: canonicalJson(z.json().parse(command.operation.payload)),
    },
    source: {
      state: attempt.state,
      reference: captured.published.reference,
      outcome: captured.published.outcome,
      outcomeHash: captured.published.outcomeHash,
      attemptHash: identityHash(moviePlexAttemptParentV2(attempt)),
      attemptRaw: canonicalJson(moviePlexAttemptParentV2(attempt)),
      commandHash: identityHash(moviePlexCommandParentV2(sourceCommand)),
      commandRaw: canonicalJson(moviePlexCommandParentV2(sourceCommand)),
      commandPayloadRaw: canonicalJson(z.json().parse(sourceCommand.payload)),
    },
    rejection: null,
    playback: authority.playback.reference,
    captionManifest: input.captions,
    captionManifestRaw: canonicalJson(z.json().parse(input.captions)),
    predecessor: captured.predecessor,
    successor: captured.successor,
    successorGrant: captured.publication,
    successorGrantRaw: canonicalJson(z.json().parse(captured.publication)),
    originalItem: {
      binding: {
        scope: previous.scope,
        evidenceId: previous.evidence.id,
        associationHash: previous.evidence.associationHash,
        revision: previous.revision,
      },
      ratingKey: association.item.ratingKey,
      part: { id: part.id, file: part.file },
    },
    originalAccess: association.access,
    pointer: {
      scope: captured.binding.snapshot.scope,
      revision: captured.binding.snapshot.revision,
      evidence: {
        id: captured.binding.snapshot.evidenceId,
        associationHash: captured.binding.snapshot.associationHash,
      },
    },
    access: input.access,
    authority: {
      generation: command.expected.generation,
      recoveryEpoch: command.expected.recoveryEpoch,
      identityHash: identityHash(attempt.identityEvidence),
      identityRaw: canonicalJson(z.json().parse(attempt.identityEvidence)),
      birthHash: identityHash({
        choiceId: attempt.movieEditionChoiceId,
        choiceRevision: attempt.movieEditionChoiceRevision,
        authority: attempt.movieEditionAuthority,
      }),
      birthRaw: canonicalJson({
        choiceId: attempt.movieEditionChoiceId,
        choiceRevision: attempt.movieEditionChoiceRevision,
        authority: z.json().parse(attempt.movieEditionAuthority),
      }),
      generationsHash: identityHash(attempt.generations),
      generationsRaw: canonicalJson(z.json().parse(attempt.generations)),
      ...authority.profile,
    },
    cleanup: command.expected.cleanup,
    observedAt: new Date(context.execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(context.execution.expiresAtMs).toISOString(),
    expiresAt: new Date(authority.freshness.expiresAtMs).toISOString(),
    admittedAt: new Date().toISOString(),
    owner,
  });
  assertRollbackOriginalEvidence(intent, evidence, association, original);
  reserveRequestedMovieRollbackIntentSqlV1(invocation.budget, intent);
  authority.freshness.assertActive();
  const cancelled =
    await tx.$executeRaw`UPDATE "UpgradeCleanup" SET state='cancelled',version=version+1
    WHERE id=${command.expected.cleanup.id} AND version=${command.expected.cleanup.version} AND state='pending'
      AND "assetId"=${intent.predecessor.id} AND "successorAssetId"=${intent.successor.id}
      AND ("expiresAt" AT TIME ZONE 'UTC')=${command.expected.cleanup.expiresAt}::timestamptz AND clock_timestamp()< ("expiresAt" AT TIME ZONE 'UTC')`;
  if (cancelled !== 1)
    throw new FileGuardError("movie_rollback_cleanup_changed");
  const envelope = {
    intent: z.json().parse(intent),
    intentHash: identityHash(intent),
    raw: canonicalJson(z.json().parse(intent)),
  };
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackIntentV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${command.operation.id} AND payload=${JSON.stringify(command.operation.payload)}::jsonb
      AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackIntentV1')`;
  if (changed !== 1)
    throw new FileGuardError("movie_rollback_admission_changed");
  authority.freshness.assertActive();
  return {
    operation: command.operation,
    intent,
    intentHash: envelope.intentHash,
  };
}
