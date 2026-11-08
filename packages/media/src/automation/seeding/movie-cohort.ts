import { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieAcquisitionIdentitySchema } from "#shared/movie-editions/management/contracts.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { resolveMovieTransferSourceV1 } from "#automation/movie-editions/transfer-reuse/source.ts";
import { readMovieTransferReuseMarkerV1 } from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { movieSourcePublicationDependencies } from "./movie-dependencies.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import path from "node:path";
import { movieTransferObservationMatches } from "#automation/movie-editions/transfer-reuse/observation.ts";

export async function movieSourceCohort(
  tx: Prisma.TransactionClient,
  torrentId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const torrent = await tx.torrent.findUniqueOrThrow({
    where: { id: torrentId },
  });
  budget.consume(1);
  const attempts = await tx.acquisitionAttempt.findMany({
    where: { torrentId },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(attempts.length);
  const rows = await tx.libraryAsset.findMany({
    where: { torrentId },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  const assets = [];
  for (const asset of rows) {
    const coverage = await tx.assetCoverage.findMany({
      where: { assetId: asset.id },
      orderBy: { mediaId: "asc" },
      take: budget.take,
    });
    budget.consume(coverage.length);
    assets.push({ ...asset, coverage });
  }
  return { ...torrent, attempts, assets };
}

/** Full cohort, flat immutable source relation and actual outcomes, never a terminal-state shortcut. */
export async function movieSourceDependencies(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  torrent: Awaited<ReturnType<typeof movieSourceCohort>>,
  input: {
    observed: TorrentObservation;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { observed, budget } = input;
  const owners = torrent.attempts.filter((attempt) =>
    ownedTorrent(context, observed, attempt),
  );
  const owner = owners[0];
  if (owner === undefined || owners.length !== 1) return null;
  const identity = MovieAcquisitionIdentitySchema.safeParse(
    owner.identityEvidence,
  );
  if (!identity.success) return null;
  const scope = identity.data.scope;
  const originalBirth = await tx.operation.findUniqueOrThrow({
    where: { id: owner.operationId },
  });
  budget.consume(1);
  if (readMovieTransferReuseMarkerV1(originalBirth.result) !== null)
    return null;
  const recorded = await readMovieAttemptIdentityV4(tx, owner, scope, budget);
  if (
    !torrent.owned ||
    torrent.providerId !== recorded.release.providerId ||
    torrent.infoHash !==
      CandidateSourceEvidenceSchema.parse(recorded.release.sourceEvidence)
        .infoHash ||
    torrent.qbittorrentId !== observed.hash ||
    owner.recoveryEpoch !== torrent.ownershipEpoch
  )
    return null;
  for (const member of torrent.attempts) {
    const parsed = MovieAcquisitionIdentitySchema.safeParse(
      member.identityEvidence,
    );
    if (
      !parsed.success ||
      identityHash(parsed.data.scope) !== identityHash(scope) ||
      member.recoveryEpoch !== torrent.ownershipEpoch
    )
      return null;
    if (member.id !== owner.id) {
      const source = await resolveMovieTransferSourceV1(tx, member, budget);
      if (
        source.grant === null ||
        source.owner.id !== owner.id ||
        !movieTransferObservationMatches(source.grant.transfer, observed)
      )
        return null;
    }
  }
  const dependenciesRemaining = await movieSourcePublicationDependencies(
    tx,
    torrent,
    { scope, isolated: path.join(context.downloadRoot, "media", owner.id) },
    budget,
  );
  return dependenciesRemaining === null
    ? null
    : { owner, scope, dependenciesRemaining };
}

export async function lockMovieSourceParticipants(
  tx: Prisma.TransactionClient,
  torrent: Awaited<ReturnType<typeof movieSourceCohort>>,
) {
  if (torrent.attempts.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE id IN (${Prisma.join(torrent.attempts.map((a) => a.id))}) ORDER BY id FOR UPDATE`,
    );
  await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${torrent.id} FOR UPDATE`;
  if (torrent.assets.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(torrent.assets.map((a) => a.id))}) ORDER BY id FOR UPDATE`,
    );
}
