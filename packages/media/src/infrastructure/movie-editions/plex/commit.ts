import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MoviePlexReceiptV2Schema,
  MovieServingPlexV2Schema,
  type VerifiedMovieServingPlexV2,
} from "#shared/movie-editions/plex-v2.ts";
import { PlexBindingSnapshotSchema } from "#shared/plex-binding/contract.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { captureMoviePlexExpectedV2 } from "./expected.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
  readMoviePlexReceiptV2,
} from "./receipt.ts";

/** Same locked transaction as scoped availability and its immutable completed-command receipt. */
export async function commitMoviePlexV2(
  tx: Prisma.TransactionClient,
  input: {
    input: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
    expected: PlexBindingExpected;
    verified: VerifiedMovieServingPlexV2;
    observed: { wall: number; monotonic: number };
  },
  budget: PublicationAuthorityReadBudget,
) {
  const current = await captureMoviePlexExpectedV2(
    tx,
    input.input,
    input.access,
    budget,
  );
  const { freshness, ...body } = input.verified;
  const observation = MovieServingPlexV2Schema.parse(body);
  freshness.assertActive();
  current.authority.freshness.assertActive();
  if (identityHash(current.expected) !== identityHash(input.expected))
    throw new PlexBindingProtection("scope_changed");
  const association = assertMoviePlexObservation(
    current.expected,
    observation,
    freshness.expiresAtMs,
  );
  const guarded = plexBindingFreshness({
    observed: input.observed,
    expiresAtMs: Math.min(
      freshness.expiresAtMs,
      current.authority.freshness.expiresAtMs,
      current.leaseExpiresAtMs,
    ),
    guards: [freshness, current.authority.freshness],
  });
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + input.access.serverMachineId},0))::text`;
  await bindPlexTransactionDeadline(tx, guarded);
  const hash = identityHash(association);
  await tx.plexAssociationEvidence.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        mediaId: input.input.scope.mediaId,
        edition: input.input.scope.edition,
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
        mediaId: input.input.scope.mediaId,
        edition: input.input.scope.edition,
        associationHash: hash,
      },
    },
  });
  budget.consume(1);
  if (
    identityHash(evidence.evidence) !== hash ||
    evidence.assetId !== current.asset.id ||
    evidence.serverMachineId !== input.access.serverMachineId
  )
    throw new Error("Movie Plex immutable evidence insert changed");
  const prior = current.expected.previous[0];
  if (prior === undefined)
    throw new Error("Movie Plex previous pointer missing");
  const binding = PlexBindingSnapshotSchema.parse({
    scope: association.scope,
    evidenceId: evidence.id,
    associationHash: hash,
    revision:
      prior.revision + (prior.evidence?.associationHash === hash ? 0 : 1),
  });
  await replacePlexClaims(
    tx,
    {
      serverMachineId: input.access.serverMachineId,
      oldGroups: current.expected.oldGroups,
      members: [
        { association, evidenceId: evidence.id, associationHash: hash },
      ],
    },
    guarded,
  );
  const times = {
    verifiedStartedAt: new Date(observation.verification.startedAt),
    verifiedCompletedAt: new Date(observation.verification.completedAt),
  };
  await tx.plexBindingCurrent.upsert({
    where: { mediaId_edition: association.scope },
    create: {
      ...association.scope,
      evidenceId: evidence.id,
      associationHash: hash,
      revision: binding.revision,
      ...times,
    },
    update: {
      evidenceId: evidence.id,
      associationHash: hash,
      revision: binding.revision,
      ...times,
    },
  });
  if (prior.evidence?.associationHash !== hash) {
    await tx.plexWatchProjection.deleteMany({ where: association.scope });
    await tx.watchState.deleteMany({ where: association.scope });
    await tx.retentionDecision.updateMany({
      where: {
        ...association.scope,
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: { state: "cancelled", version: { increment: 1 } },
    });
  }
  const timestamp = new Date();
  await tx.libraryAsset.updateMany({
    where: { id: current.asset.id, plexPublishedAt: null },
    data: { plexPublishedAt: timestamp },
  });
  const published = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: current.asset.id },
    select: { plexPublishedAt: true },
  });
  budget.consume(1);
  if (published.plexPublishedAt === null)
    throw new Error("Verified movie publication timestamp missing");
  await tx.mediaIntent.update({
    where: { mediaId_edition: association.scope },
    data: { availability: "available" },
  });
  await tx.mediaItem.update({
    where: { id: association.scope.mediaId },
    data: {
      version: { increment: 1 },
      ...(association.scope.edition === "default"
        ? { availability: "available" as const }
        : {}),
    },
  });
  const publication = current.publication;
  const receipt = MoviePlexReceiptV2Schema.parse({
    schemaVersion: 2,
    input: input.input,
    command: moviePlexCommandParentV2(current.command),
    attempt: moviePlexAttemptParentV2(current.attempt),
    publication: {
      transitionId: publication.reference.transitionId,
      intentHash: publication.reference.intentHash,
      outcomeHash: publication.outcomeHash,
    },
    expected: current.expected,
    observation,
    binding,
    publishedAt: published.plexPublishedAt.toISOString(),
    committedAt: new Date().toISOString(),
  });
  const envelope = {
    receiptHash: identityHash(receipt),
    receipt: z.json().parse(receipt),
  };
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('moviePlexReceiptV2',${JSON.stringify(envelope)}::jsonb) WHERE id=${input.input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'moviePlexReceiptV2')`;
  if (updated !== 1)
    throw new Error("Movie Plex completion was already recorded");
  guarded.assertActive();
  const stored = await readMoviePlexReceiptV2(tx, input.input, budget);
  if (identityHash(stored) !== identityHash(receipt))
    throw new Error("Movie Plex completed receipt insert changed");
  return receipt;
}

function assertMoviePlexObservation(
  expected: PlexBindingExpected,
  observation: z.infer<typeof MovieServingPlexV2Schema>,
  expiresAtMs: number,
) {
  const association = observation.associations[0];
  const target = expected.targets[0];
  if (
    identityHash(association.group) !== identityHash(expected.newGroups[0]) ||
    association.canonicalIdentityHash !== target?.canonicalIdentityHash ||
    association.numberingHash !== target.numberingHash ||
    identityHash(association.definition) !== identityHash(target.definition) ||
    identityHash(expected.access) !== identityHash([association.access]) ||
    Date.parse(observation.verification.expiresAt) > expiresAtMs
  )
    throw new Error("Movie Plex observation differs from captured authority");
  return association;
}
