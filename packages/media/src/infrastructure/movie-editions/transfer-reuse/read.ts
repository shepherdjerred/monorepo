import { z } from "zod";
import {
  Prisma,
  type AcquisitionAttempt,
  type Torrent,
} from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  movieRetryBirthHash,
  RetryProfile,
} from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import {
  MovieAcquisitionIdentitySchema,
  type MovieAcquisitionIdentity,
} from "#shared/movie-editions/management/contracts.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieTransferReuseEnvelopeV1Schema } from "#shared/movie-editions/transfer-reuse/v1.ts";
import type { MovieTransferReuseGrantV1 } from "#shared/movie-editions/transfer-reuse/v1.ts";

type Recorded = {
  identity: MovieAcquisitionIdentity;
  profile: z.infer<typeof RetryProfile>;
};
export type MovieTransferReadOptions = {
  lock?: boolean;
  actualSource?: {
    transaction: Prisma.TransactionClient;
    torrent: Torrent;
    infoHash: string;
    providerId: string;
  };
};

function literalIdentity(attempt: AcquisitionAttempt) {
  return {
    identity: MovieAcquisitionIdentitySchema.parse(attempt.identityEvidence),
    profile: RetryProfile.parse(attempt.failure),
  };
}

async function sourceTorrent(
  tx: Prisma.TransactionClient,
  origin: AcquisitionAttempt,
  budget: PublicationAuthorityReadBudget,
  actual: MovieTransferReadOptions["actualSource"],
) {
  if (origin.torrentId === null)
    throw new Error("Movie source origin lost its actual Torrent parent");
  if (actual !== undefined) return actual.torrent;
  const torrent = await tx.torrent.findUniqueOrThrow({
    where: { id: origin.torrentId },
  });
  budget.consume(1);
  return torrent;
}

function assertConsumer(
  grant: MovieTransferReuseGrantV1,
  attempt: AcquisitionAttempt,
  current: Recorded,
) {
  const serverMachineId =
    current.identity.schemaVersion === 2
      ? current.identity.sponsorAuthority.serverMachineId
      : current.identity.management.serverMachineId;
  if (
    attempt.id !== grant.consumer.attemptId ||
    attempt.operationId !== grant.consumer.birthOperationId ||
    movieRetryBirthHash(attempt) !== grant.consumer.birthHash ||
    identityHash(current.identity) !== grant.consumer.identityHash ||
    current.identity.assessment.id !== grant.consumer.assessmentId ||
    current.identity.assessment.hash !== grant.consumer.assessmentHash ||
    current.profile.profileId !== grant.consumer.profileId ||
    current.profile.profileVersion !== grant.consumer.profileVersion ||
    z.record(z.string(), z.int()).parse(attempt.generations)[
      grant.scope.mediaId
    ] !== grant.consumer.generation ||
    grant.input.attemptId !== attempt.id ||
    grant.input.operationId !== attempt.operationId ||
    identityHash(grant.input.scope) !== identityHash(grant.scope) ||
    identityHash(current.identity.scope) !== identityHash(grant.scope) ||
    grant.consumer.access.serverMachineId !== serverMachineId ||
    (current.identity.schemaVersion === 3 &&
      grant.consumer.access.movieSectionId !==
        current.identity.management.sectionId)
  )
    throw new Error("Movie transfer consumer lost its exact immutable birth");
}

function assertOrigin(
  grant: MovieTransferReuseGrantV1,
  origin: AcquisitionAttempt,
  old: Recorded,
) {
  if (
    origin.id === grant.consumer.attemptId ||
    origin.operationId !== grant.origin.birthOperationId ||
    origin.coordinatorOperationId !== grant.origin.coordinatorOperationId ||
    origin.state !== "cancelled" ||
    origin.filePlan !== null ||
    movieRetryBirthHash(origin) !== grant.origin.birthHash ||
    identityHash(old.identity) !== grant.origin.identityHash ||
    old.identity.source.candidateDigest !== grant.origin.sourceHash ||
    origin.releaseId !== grant.origin.releaseId ||
    identityHash(old.identity.scope) !== identityHash(grant.scope)
  )
    throw new Error("Movie transfer origin lost its exact immutable birth");
}

export function readMovieTransferReuseMarkerV1(raw: unknown) {
  const marker = z
    .object({ movieTransferReuseGrantV1: z.unknown().optional() })
    .nullable()
    .parse(raw)?.movieTransferReuseGrantV1;
  if (marker === undefined) return null;
  const envelope = MovieTransferReuseEnvelopeV1Schema.parse(marker);
  if (identityHash(envelope.grant) !== envelope.grantHash)
    throw new Error("Movie transfer grant hash changed");
  return envelope.grant;
}

/** Resolve by immutable birth, even after a legitimate coordinator renewal. Corruption never falls back. */
export async function readMovieTransferReuseGrantV1(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  budget: PublicationAuthorityReadBudget,
  options: MovieTransferReadOptions = {},
) {
  if (
    options.actualSource !== undefined &&
    options.actualSource.transaction !== tx
  )
    throw new Error("Movie source snapshot belongs to another transaction");
  const birth = await tx.operation.findUniqueOrThrow({
    where: { id: attempt.operationId },
  });
  budget.consume(1);
  const grant = readMovieTransferReuseMarkerV1(birth.result);
  if (grant === null) return null;
  if (options.lock === true) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE id IN (${Prisma.join([attempt.id, grant.origin.attemptId].sort())}) ORDER BY id FOR SHARE`,
    );
    await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${grant.transfer.id} FOR SHARE`;
  }
  const origin = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: grant.origin.attemptId },
  });
  budget.consume(1);
  const torrent = await sourceTorrent(tx, origin, budget, options.actualSource);
  // SQL049 freezes the exact grant and origin ancestry. Each caller still reads
  // these actual immediate parents; current effect authority is independently fresh.
  const old = literalIdentity(origin);
  const current = literalIdentity(attempt);
  assertConsumer(grant, attempt, current);
  assertOrigin(grant, origin, old);
  if (
    identityHash(current.identity.source) !==
      identityHash(old.identity.source) ||
    origin.recoveryEpoch !== attempt.recoveryEpoch ||
    torrent.id !== grant.transfer.id ||
    origin.torrentId !== torrent.id ||
    attempt.torrentId !== torrent.id ||
    !torrent.owned ||
    torrent.ownershipEpoch !== attempt.recoveryEpoch ||
    torrent.infoHash !== grant.transfer.infoHash ||
    torrent.qbittorrentId !== grant.transfer.qbittorrentId ||
    torrent.providerId !== grant.transfer.providerId ||
    identityHash(torrent.seedingPolicy) !== grant.transfer.policyHash
  )
    throw new Error("Movie transfer grant lost its exact immutable parents");
  return { grant, origin, torrent };
}
