import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import {
  MovieServingPlexV2Schema,
  type VerifiedMovieServingPlexV2,
} from "#shared/movie-editions/plex-v2.ts";
import {
  MovieRollbackPlexV1Schema,
  type MovieRollbackPlexExpectedV1,
} from "#shared/movie-editions/rollback/plex.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { writePlexBindingPointers } from "#infrastructure/plex-binding/commit.ts";
import { captureMovieRollbackPlexExpectedV1 } from "./plex-expected.ts";
import { assertMovieRollbackPlexV1 } from "./validation.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { movieRollbackTransactionId } from "./transaction.ts";
import { reserveMovieRollbackPlexSqlV1 } from "./read-budget.ts";
import type { MovieRollbackOperationV1 } from "#shared/movie-editions/rollback/operation.ts";
import { captureRequestedMovieRollbackPlexExpectedV1 } from "./manual/manual-plex-expected.ts";
import { reserveRequestedMovieRollbackPlexSqlV1 } from "./manual/manual-read-budget.ts";
import type { MovieRollbackHandoffExecutionV1 } from "./retry/handoff-execution.ts";

/** The fresh original-item rebind and exact reservation release commit together. */
export async function commitMovieRollbackPlexV1(
  tx: Prisma.TransactionClient,
  input: {
    source: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
    expected: MovieRollbackPlexExpectedV1;
    verified: VerifiedMovieServingPlexV2;
    invocation: MovieManagementInvocation;
    manualCommand?: MovieRollbackOperationV1;
    handoff?: MovieRollbackHandoffExecutionV1;
  },
) {
  const captured =
    input.manualCommand === undefined
      ? {
          mode: "automatic_failed_plex" as const,
          current: await captureMovieRollbackPlexExpectedV1(tx, input),
        }
      : {
          mode: "manual_verified" as const,
          current: await captureRequestedMovieRollbackPlexExpectedV1(tx, {
            command: input.manualCommand,
            access: input.access,
            invocation: input.invocation,
            ...(input.handoff === undefined ? {} : { handoff: input.handoff }),
          }),
        };
  const current = captured.current;
  const { freshness, ...raw } = input.verified;
  const observation = MovieServingPlexV2Schema.parse(raw);
  current.freshness.assertActive();
  freshness.assertActive();
  if (
    identityHash(current.expected) !== identityHash(input.expected) ||
    freshness.expiresAtMs >
      Math.min(current.freshness.expiresAtMs, current.writerExpiresAtMs)
  )
    throw new PlexBindingProtection("scope_changed");
  const association = observation.associations[0];
  const hash = identityHash(association);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + input.access.serverMachineId},0))::text`;
  await bindPlexTransactionDeadline(tx, freshness);
  if (captured.mode === "automatic_failed_plex") {
    reserveMovieRollbackPlexSqlV1(
      input.invocation.budget,
      captured.current.identitySchemaVersion,
      current.parent.intent,
    );
  } else {
    reserveRequestedMovieRollbackPlexSqlV1(
      input.invocation.budget,
      current.parent.intent,
    );
  }
  if (current.handoff !== null) input.invocation.budget.consume(4);
  await tx.plexAssociationEvidence.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        mediaId: input.source.scope.mediaId,
        edition: input.source.scope.edition,
        assetId: current.asset.id,
        serverMachineId: input.access.serverMachineId,
        associationHash: hash,
        evidence: z.record(z.string(), z.json()).parse(association),
      },
    ],
    skipDuplicates: true,
  });
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: {
      mediaId_edition_associationHash: {
        mediaId: input.source.scope.mediaId,
        edition: input.source.scope.edition,
        associationHash: hash,
      },
    },
  });
  input.invocation.budget.consume(1);
  if (
    identityHash(evidence.evidence) !== hash ||
    evidence.assetId !== current.asset.id ||
    evidence.serverMachineId !== input.access.serverMachineId
  )
    throw new Error(
      "Movie rollback serving association changed its actual inserted evidence",
    );
  const binding = PlexBindingSnapshotSchema.parse({
    scope: association.scope,
    evidenceId: evidence.id,
    associationHash: hash,
    revision: current.expected.previous[0].revision + 1,
  });
  const receipt = MovieRollbackPlexV1Schema.parse({
    schemaVersion: 1,
    transactionId: await movieRollbackTransactionId(tx),
    operationId: current.parent.intent.operationId,
    invocation: current.parent.intent.invocation,
    intentId: current.parent.intent.id,
    intentHash: current.parent.intentHash,
    physicalHash: current.parent.physicalHash,
    publication: current.parent.reference,
    expected: current.expected,
    observation,
    binding,
    sdk: {
      observedAt: new Date(
        input.invocation.execution.observed.wall,
      ).toISOString(),
      expiresAt: new Date(input.invocation.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(current.writerExpiresAtMs).toISOString(),
    assetPlexPublishedAt: current.asset.plexPublishedAt,
    reboundAt: new Date().toISOString(),
    committedAt: new Date().toISOString(),
  });
  assertMovieRollbackPlexV1(receipt, {
    intent: current.parent.intent,
    physical: current.parent.receipt,
  });
  await replacePlexClaims(
    tx,
    {
      serverMachineId: input.access.serverMachineId,
      oldGroups: [],
      members: [
        { association, evidenceId: evidence.id, associationHash: hash },
      ],
    },
    freshness,
  );
  await writePlexBindingPointers(
    tx,
    {
      expected: current.expected,
      bindings: [binding],
      startedAt: observation.verification.startedAt,
      completedAt: observation.verification.completedAt,
    },
    freshness,
  );
  await tx.mediaIntent.update({
    where: { mediaId_edition: association.scope },
    data: { availability: "available" },
  });
  await tx.mediaItem.update({
    where: { id: input.source.scope.mediaId },
    data: {
      version: { increment: 1 },
      ...(input.source.scope.edition === "default"
        ? { availability: "available" as const }
        : {}),
    },
  });
  await tx.acquisitionReservation.deleteMany({
    where: {
      ...association.scope,
      attemptId: input.source.attemptId,
      generation: current.parent.intent.authority.generation,
    },
  });
  const envelope = {
    receipt: z.json().parse(receipt),
    receiptHash: identityHash(receipt),
    raw: canonicalJson(z.json().parse(receipt)),
  };
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRollbackPlexV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${current.parent.intent.operationId} AND result#>>'{movieRollbackPhysicalV1,receiptHash}'=${current.parent.physicalHash} AND NOT(COALESCE(result,'{}'::jsonb)?'movieRollbackPlexV1')`;
  if (updated !== 1)
    throw new Error("Movie rollback rebind lost its exact physical operation");
  current.freshness.assertActive();
  freshness.assertActive();
  return receipt;
}
