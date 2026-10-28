import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import {
  MovieServingPlexV2Schema,
  type VerifiedMovieServingPlexV2,
} from "#shared/movie-editions/plex-v2.ts";
import {
  MovieRestorePlexReceiptV1Schema,
  type MovieRestorePlexExpectedV1,
} from "#shared/movie-editions/restore-plex-v1.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { writePlexBindingPointers } from "#infrastructure/plex-binding/commit.ts";
import { captureMovieRestorePlexExpectedV1 } from "./restore-plex-expected.ts";
import {
  assertMovieRestorePlexObservation,
  assertMovieRestorePlexReceiptV1,
} from "./restore-plex-observation.ts";
import { readMovieRestorePlexReceiptV1 } from "./restore-plex-receipt.ts";

/** Exact source recapture, immutable association, claims, pointer and serving completion share one transaction. */
export async function commitMovieRestorePlexV1(
  tx: Prisma.TransactionClient,
  input: {
    command: MovieOperationV4;
    access: MovieChoiceAccess;
    expected: MovieRestorePlexExpectedV1;
    verified: VerifiedMovieServingPlexV2;
    invocation: MovieManagementInvocation;
  },
) {
  const { invocation } = input;
  const current = await captureMovieRestorePlexExpectedV1(tx, input);
  const { freshness, ...body } = input.verified;
  const observation = MovieServingPlexV2Schema.parse(body);
  freshness.assertActive();
  current.freshness.assertActive();
  if (
    identityHash(current.expected) !== identityHash(input.expected) ||
    freshness.expiresAtMs >
      Math.min(current.freshness.expiresAtMs, current.writerExpiresAtMs)
  )
    throw new PlexBindingProtection("scope_changed");
  const association = assertMovieRestorePlexObservation(
    current.expected,
    observation,
    current.freshness.expiresAtMs,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + input.access.serverMachineId},0))::text`;
  await bindPlexTransactionDeadline(tx, freshness);
  const hash = identityHash(association);
  await tx.plexAssociationEvidence.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        mediaId: input.command.mediaId,
        edition: input.command.scope.edition,
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
        mediaId: input.command.mediaId,
        edition: input.command.scope.edition,
        associationHash: hash,
      },
    },
  });
  invocation.budget.consume(1);
  if (
    identityHash(evidence.evidence) !== hash ||
    evidence.assetId !== current.asset.id ||
    evidence.serverMachineId !== input.access.serverMachineId
  )
    throw new Error("Movie restore Plex association insert changed");
  const binding = PlexBindingSnapshotSchema.parse({
    scope: association.scope,
    evidenceId: evidence.id,
    associationHash: hash,
    revision: current.expected.previous[0].revision + 1,
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
  await tx.plexWatchProjection.deleteMany({ where: association.scope });
  await tx.watchState.deleteMany({ where: association.scope });
  await tx.retentionDecision.updateMany({
    where: {
      ...association.scope,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
  const reboundAt = new Date().toISOString();
  await tx.mediaIntent.update({
    where: { mediaId_edition: association.scope },
    data: { availability: "available" },
  });
  await tx.mediaItem.update({
    where: { id: input.command.mediaId },
    data: {
      version: { increment: 1 },
      ...(input.command.scope.edition === "default"
        ? { availability: "available" as const }
        : {}),
    },
  });
  const receipt = MovieRestorePlexReceiptV1Schema.parse({
    schemaVersion: 1,
    input: input.command,
    command: {
      kind: current.operation.kind,
      targetId: current.operation.targetId,
      userId: current.operation.userId,
      payloadHash: identityHash(current.operation.payload),
    },
    publication: current.parent.reference,
    expected: current.expected,
    observation,
    binding,
    sdk: {
      observedAt: new Date(invocation.execution.observed.wall).toISOString(),
      expiresAt: new Date(invocation.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(current.writerExpiresAtMs).toISOString(),
    assetPlexPublishedAt: current.asset.plexPublishedAt,
    reboundAt,
    committedAt: new Date().toISOString(),
  });
  assertMovieRestorePlexReceiptV1(receipt);
  const envelope = {
    receipt: z.json().parse(receipt),
    receiptHash: identityHash(receipt),
  };
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('movieRestorePlexReceiptV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${input.command.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'movieRestorePlexReceiptV1')`;
  if (updated !== 1)
    throw new Error("Movie restore Plex completion was already recorded");
  const stored = await readMovieRestorePlexReceiptV1(
    tx,
    input.command,
    invocation.budget,
  );
  if (identityHash(stored) !== identityHash(receipt))
    throw new Error("Movie restore Plex committed receipt changed");
  freshness.assertActive();
  current.freshness.assertActive();
  return receipt;
}
