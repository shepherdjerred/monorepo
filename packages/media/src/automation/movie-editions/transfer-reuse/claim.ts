import path from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type {
  AcquisitionAttempt,
  Torrent,
  LibraryAsset,
} from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { serializable } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { movieRetryBirthHash } from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import { readMovieTransferReuseMarkerV1 } from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { commitMovieTransferReuseGrantV1 } from "#infrastructure/movie-editions/transfer-reuse/commit.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieTransferReuseGrantV1Schema } from "#shared/movie-editions/transfer-reuse/v1.ts";
import { movieRetryTerminalV1 } from "#automation/movie-editions/retry/terminal.ts";
import { resolveMovieTransferSourceV1 } from "./source.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { movieTransferObservationMatches } from "./observation.ts";
import { reserveMovieTransferObservationWriteV1 } from "#infrastructure/movie-editions/transfer-reuse/observation-write.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  movieSourceCohort,
  movieSourceDependencies,
} from "#automation/seeding/movie-cohort.ts";

function availableSource(
  attempt: AcquisitionAttempt,
  torrent: Torrent,
  observed: TorrentObservation,
) {
  return (
    attempt.state === "reserved" &&
    attempt.torrentId === null &&
    attempt.filePlan === null &&
    torrent.owned &&
    torrent.ownershipEpoch === attempt.recoveryEpoch &&
    torrent.qbittorrentId === observed.hash &&
    !["removing", "removed"].includes(torrent.state) &&
    hasApplicationSeedingPolicy(observed)
  );
}

function cancelledOrigin(origin: AcquisitionAttempt): boolean {
  return (
    origin.state === "cancelled" &&
    origin.filePlan === null &&
    origin.coordinatorOperationId !== null
  );
}

function singleOrigin(origins: AcquisitionAttempt[]) {
  const origin = origins[0];
  return origin === undefined ||
    origins.length !== 1 ||
    !cancelledOrigin(origin)
    ? null
    : origin;
}

function originStillCurrent(
  current: AcquisitionAttempt,
  original: AcquisitionAttempt,
) {
  return (
    cancelledOrigin(current) &&
    current.coordinatorOperationId === original.coordinatorOperationId &&
    movieRetryBirthHash(current) === movieRetryBirthHash(original)
  );
}

function liveSourceAgrees(
  context: MediaAutomationContext,
  live: TorrentObservation,
  owner: AcquisitionAttempt,
  qbittorrentId: string | null,
) {
  return (
    ownedObservation(context, live, owner) &&
    live.hash === qbittorrentId &&
    path.resolve(live.content_path) !== path.resolve(live.save_path) &&
    path
      .resolve(live.content_path)
      .startsWith(`${path.resolve(live.save_path)}/`)
  );
}

function ownedObservation(
  context: MediaAutomationContext,
  observed: TorrentObservation | null,
  owner: AcquisitionAttempt,
) {
  return (
    observed !== null &&
    ownedTorrent(context, observed, owner) &&
    hasApplicationSeedingPolicy(observed)
  );
}

function grantedSourceAvailable(
  context: MediaAutomationContext,
  observed: TorrentObservation | null,
  existing: Awaited<ReturnType<typeof resolveMovieTransferSourceV1>>,
) {
  return (
    existing.torrent !== null &&
    observed !== null &&
    movieTransferObservationMatches(existing.grant.transfer, observed) &&
    !["removing", "removed"].includes(existing.torrent.state) &&
    ownedObservation(context, observed, existing.owner)
  );
}

async function flatCohort(
  context: MediaAutomationContext,
  cohort: AcquisitionAttempt[],
  originId: string,
  budget: PublicationAuthorityReadBudget,
) {
  for (const member of cohort) {
    if (member.id === originId) continue;
    const source = await resolveMovieTransferSourceV1(
      context.db,
      member,
      budget,
    );
    if (source.owner.id !== originId || source.grant === null) return false;
  }
  return true;
}

function sameSourceCohort(
  current: Torrent & { attempts: AcquisitionAttempt[]; assets: LibraryAsset[] },
  original: Torrent,
  input: {
    attempt: AcquisitionAttempt;
    command: MovieAttemptOperationV4;
    cohort: AcquisitionAttempt[];
  },
) {
  return (
    !["removing", "removed"].includes(current.state) &&
    current.owned &&
    current.ownershipEpoch === input.attempt.recoveryEpoch &&
    identityHash(current.seedingPolicy) ===
      identityHash(original.seedingPolicy) &&
    identityHash(current.attempts.map((a) => a.id)) ===
      identityHash(input.cohort.map((a) => a.id)) &&
    current.assets.every(
      (a) =>
        a.edition === input.command.scope.edition &&
        a.editionRootId === input.command.scope.mediaId,
    )
  );
}

/** null means no registered source exists. Every recognized uncertain source protects instead of adding. */
export async function claimMovieTransferReuseV1(
  initial: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  input: MovieAttemptOperationV4,
  observed: TorrentObservation | null,
): Promise<{ status: "submitted" | "blocked"; reason: string | null } | null> {
  const context = movieManagementContext(initial);
  const { budget, execution } = context.movieManagement;
  execution.assertActive();
  const existing = await resolveMovieTransferSourceV1(
    context.db,
    attempt,
    budget,
  );
  if (existing.grant !== null)
    return grantedSourceAvailable(context, observed, existing)
      ? { status: "submitted", reason: null }
      : { status: "blocked", reason: "source_ownership_unproven" };
  const selected = await readMovieAttemptIdentityV4(
    context.db,
    attempt,
    input.scope,
    budget,
  );
  const originalSource = CandidateSourceEvidenceSchema.parse(
    selected.release.sourceEvidence,
  );
  const torrent = await context.db.torrent.findUnique({
    where: { infoHash: originalSource.infoHash },
  });
  budget.consume(torrent === null ? 0 : 1);
  if (torrent === null) return null;
  if (
    observed !== null &&
    attempt.torrentId === torrent.id &&
    ownedTorrent(context, observed, attempt)
  )
    return null;
  const blocked = {
    status: "blocked" as const,
    reason: "source_ownership_unproven",
  };
  if (
    observed === null ||
    torrent.providerId !== selected.release.providerId ||
    !availableSource(attempt, torrent, observed)
  )
    return blocked;
  const cohort = await context.db.acquisitionAttempt.findMany({
    where: { torrentId: torrent.id },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(cohort.length);
  const origins = cohort.filter((row) => ownedTorrent(context, observed, row));
  const origin = singleOrigin(origins);
  if (origin === null) return blocked;
  const coordinatorOperationId = z.uuid().parse(origin.coordinatorOperationId);
  const old = await readMovieAttemptIdentityV4(
    context.db,
    origin,
    input.scope,
    budget,
  );
  if (
    identityHash(old.identity.source) !==
      identityHash(selected.identity.source) ||
    origin.recoveryEpoch !== attempt.recoveryEpoch
  )
    return blocked;
  const originBirth = await context.db.operation.findUniqueOrThrow({
    where: { id: origin.operationId },
  });
  budget.consume(1);
  if (readMovieTransferReuseMarkerV1(originBirth.result) !== null)
    return blocked;
  if (!(await flatCohort(context, cohort, origin.id, budget))) return blocked;
  const terminal = await movieRetryTerminalV1(
    context,
    {
      attemptId: origin.id,
      previousCoordinatorOperationId: coordinatorOperationId,
      reservedWithoutTorrent: false,
    },
    execution,
  );
  const child = terminal?.child;
  if (child === undefined || child === null)
    return {
      status: "blocked",
      reason: "movie_retry_previous_workflow_not_closed",
    };
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  return serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.scope.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
      return blocked;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "AcquisitionAttempt" WHERE id IN (${Prisma.join([...cohort.map((a) => a.id), attempt.id].sort())}) ORDER BY id FOR UPDATE`,
    );
    await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${torrent.id} FOR UPDATE`;
    const currentTorrent = await movieSourceCohort(tx, torrent.id, budget);
    if (currentTorrent.assets.length > 0)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(currentTorrent.assets.map((a) => a.id).sort())}) ORDER BY id FOR UPDATE`,
      );
    if (
      !sameSourceCohort(currentTorrent, torrent, {
        attempt,
        command: input,
        cohort,
      })
    )
      return blocked;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    const currentOrigin = currentTorrent.attempts.find(
      (a) => a.id === origin.id,
    );
    budget.consume(1);
    if (currentOrigin === undefined) return blocked;
    if (
      !originStillCurrent(currentOrigin, origin) ||
      current.coordinatorOperationId !== input.operationId ||
      current.operationId !== input.operationId
    )
      return blocked;
    const authority = await movieAttemptEffectAuthorityV4(
      tx,
      current,
      input.scope,
      { access, invocation: context.movieManagement },
    );
    if (authority === null) return blocked;
    if (!(await context.gates.acquisition())) return blocked;
    const live = await context.qbittorrent.observe(
      torrent.infoHash,
      execution.signal,
    );
    execution.assertActive();
    if (
      live === null ||
      !liveSourceAgrees(
        context,
        live,
        currentOrigin,
        currentTorrent.qbittorrentId,
      )
    )
      return blocked;
    const sourceFacts = await movieSourceDependencies(
      tx,
      context,
      currentTorrent,
      { observed: live, budget },
    );
    if (sourceFacts?.owner.id !== currentOrigin.id) return blocked;
    const writer = await tx.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    budget.consume(1);
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(
        execution.expiresAtMs,
        writer.expiresAt.getTime(),
        authority.freshness.expiresAtMs,
      ),
      guards: [execution, authority.freshness],
    });
    if (
      writer.recoveryEpoch !== current.recoveryEpoch ||
      writer.revokedAt !== null ||
      writer.observedAt.getTime() > Date.now() ||
      identityHash(
        requireMovieChoiceAccess(
          (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
        ),
      ) !== identityHash(access)
    )
      return blocked;
    const grant = MovieTransferReuseGrantV1Schema.parse({
      schemaVersion: 1,
      scope: input.scope,
      input,
      consumer: {
        attemptId: current.id,
        birthOperationId: current.operationId,
        birthHash: movieRetryBirthHash(current),
        identityHash: identityHash(authority.identity),
        generation: authority.target.generation,
        assessmentId: authority.identity.assessment.id,
        assessmentHash: authority.identity.assessment.hash,
        profileId: authority.profile.id,
        profileVersion: authority.profile.version,
        access,
      },
      origin: {
        attemptId: origin.id,
        birthOperationId: origin.operationId,
        coordinatorOperationId: origin.coordinatorOperationId,
        birthHash: movieRetryBirthHash(origin),
        identityHash: identityHash(old.identity),
        sourceHash: old.identity.source.candidateDigest,
        releaseId: origin.releaseId,
      },
      transfer: {
        id: torrent.id,
        infoHash: torrent.infoHash,
        qbittorrentId: live.hash,
        providerId: torrent.providerId,
        ownershipEpoch: torrent.ownershipEpoch,
        observationHash: identityHash(live),
        savePath: live.save_path,
        contentPath: live.content_path,
        tags: live.tags,
        category: live.category,
        policyHash: identityHash(torrent.seedingPolicy),
      },
      root: terminal?.root,
      child,
      observedAt: new Date(execution.observed.wall).toISOString(),
      sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
      expiresAt: new Date(freshness.expiresAtMs).toISOString(),
      committedAt: new Date().toISOString(),
    });
    await reserveMovieTransferObservationWriteV1(
      tx,
      { torrentId: torrent.id, observation: live },
      budget,
    );
    await tx.torrent.update({
      where: { id: torrent.id },
      data: {
        observation: { torrent: live, files: [] },
        observedAt: new Date(),
      },
    });
    await commitMovieTransferReuseGrantV1(tx, grant, freshness);
    return { status: "submitted" as const, reason: null };
  });
}
