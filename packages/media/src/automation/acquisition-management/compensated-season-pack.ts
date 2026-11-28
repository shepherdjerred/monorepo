import { z } from "zod";
import path from "node:path";
import { MediaError } from "#application/errors.ts";
import {
  Prisma,
  type AcquisitionAttempt,
  type ReleaseCandidate,
} from "#generated/prisma/client.ts";
import { parseEpisodeCoordinates } from "#domain/acquisition-identity/parser.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import {
  AcquisitionIdentitySnapshotSchema,
  CandidateSourceEvidenceSchema,
} from "#shared/acquisition/identity.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { GenerationsSchema } from "#shared/file-plan.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { ownedTorrent } from "./ownership.ts";

export const duplicateObsolete = {
  status: "obsolete",
  reason: "compensated_season_source_retained",
} as const;
const Settlement = z.object({ reason: z.literal(duplicateObsolete.reason) });
const ownershipConflict = {
  status: "blocked",
  reason: "torrent_ownership_conflict",
} as const;

function sameCoverage(left: readonly string[], sorted: readonly string[]) {
  return (
    left.length === sorted.length &&
    left.toSorted().every((id, index) => id === sorted[index])
  );
}

function ordinarySeasonSource(
  release: ReleaseCandidate,
  ids: readonly string[],
) {
  const coverage = [...new Set(ids)].sort();
  if (
    coverage.length < 2 ||
    coverage.length > 100 ||
    ids.length !== coverage.length ||
    !sameCoverage(release.mediaIds, coverage)
  )
    return null;
  const coordinates = parseEpisodeCoordinates(release.title);
  const [form] = coordinates.forms;
  if (
    coordinates.invalid ||
    coordinates.forms.length !== 1 ||
    form?.kind !== "season_pack" ||
    form.season === 0
  )
    return null;
  const evidence = CandidateSourceEvidenceSchema.safeParse(
    release.sourceEvidence,
  );
  if (!evidence.success) return null;
  return {
    releaseId: release.id,
    providerId: release.providerId,
    infoHash: evidence.data.infoHash,
    digest: candidateDigest(release),
    season: form.season,
    coverage,
  };
}
type SeasonSource = NonNullable<ReturnType<typeof ordinarySeasonSource>>;

async function retainedCompensations(
  context: MediaAutomationContext,
  tx: Prisma.TransactionClient,
  source: SeasonSource,
  epoch?: number,
) {
  const budget = context.libraryManagement?.budget;
  const matches = await tx.acquisitionAttempt.findMany({
    where: {
      releaseId: source.releaseId,
      edition: "default",
      mediaIds: { equals: source.coverage },
      state: "obsolete",
      failure: { path: ["reason"], equals: "publication_compensated" },
      filePlan: { not: Prisma.AnyNull },
      AND: [
        { identityEvidence: { path: ["schemaVersion"], equals: 1 } },
        {
          identityEvidence: {
            path: ["source", "candidateDigest"],
            equals: source.digest,
          },
        },
      ],
      ...(epoch === undefined ? {} : { recoveryEpoch: epoch }),
      torrent: {
        owned: true,
        providerId: source.providerId,
        infoHash: source.infoHash,
        ...(epoch === undefined ? {} : { ownershipEpoch: epoch }),
        state: { not: "removed" },
      },
    },
    select: {
      id: true,
      operationId: true,
      identityEvidence: true,
      torrent: { select: { id: true, qbittorrentId: true, state: true } },
    },
    take: Math.min(2, budget?.takeWeighted(2) ?? 2),
  });
  budget?.consume(matches.length * 2);
  return matches;
}

function ordinaryIdentity(
  attempt: { identityEvidence: unknown },
  source: SeasonSource,
  epoch: number,
) {
  const parsed = AcquisitionIdentitySnapshotSchema.safeParse(
    attempt.identityEvidence,
  );
  if (!parsed.success) return null;
  const { canonical, coverage, birthEpoch, source: retained } = parsed.data;
  return birthEpoch === epoch &&
    canonical.kind === "series" &&
    retained.releaseId === source.releaseId &&
    retained.candidateDigest === source.digest &&
    sameCoverage(coverage, source.coverage)
    ? canonical.coordinates.seriesId
    : null;
}

export async function hasRetainedSeasonCompensation(
  context: MediaAutomationContext,
  tx: Prisma.TransactionClient,
  release: ReleaseCandidate,
  input: { edition?: string; mediaIds?: readonly string[]; epoch?: number },
): Promise<boolean> {
  if (input.edition !== undefined && input.edition !== "default") return false;
  const source = ordinarySeasonSource(
    release,
    input.mediaIds ?? release.mediaIds,
  );
  if (source === null) return false;
  context.libraryManagement?.freshness.assertActive();
  let epoch = input.epoch;
  if (epoch === undefined) {
    const plausible = await retainedCompensations(context, tx, source);
    if (plausible.length === 0) return false;
    context.libraryManagement?.budget.consume(1);
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { recoveryEpoch: true },
    });
    epoch = runtime.recoveryEpoch;
  }
  const [prior, other] = await retainedCompensations(
    context,
    tx,
    source,
    epoch,
  );
  if (prior === undefined) return false;
  const seriesId = ordinaryIdentity(prior, source, epoch);
  return (
    other !== undefined ||
    seriesId === null ||
    (await coversCurrentSeason(context, tx, source, seriesId))
  );
}

async function coversCurrentSeason(
  context: MediaAutomationContext,
  tx: Prisma.TransactionClient,
  source: SeasonSource,
  seriesId: string,
) {
  const count = source.coverage.length;
  context.libraryManagement?.budget.consume(1);
  const [season] = await tx.$queryRaw<{ same: boolean }[]>(
    Prisma.sql`SELECT COUNT(*) = ${count} AND
      COUNT(*) FILTER (WHERE leaf.id IN (${Prisma.join(source.coverage)})) = ${count} AS same
      FROM "MediaItem" leaf LEFT JOIN "MediaItem" parent ON leaf."parentId" = parent.id
      WHERE leaf.kind = 'episode' AND leaf."seasonNumber" = ${source.season}
        AND (leaf."parentId" = ${seriesId} OR parent."parentId" = ${seriesId})`,
  );
  return season?.same === true;
}

function unsubmitted(attempt: AcquisitionAttempt, operationId: string) {
  return (
    attempt.edition === "default" &&
    attempt.torrentId === null &&
    attempt.filePlan === null &&
    (attempt.coordinatorOperationId ?? attempt.operationId) === operationId
  );
}

export function readSettledSeasonDuplicate(
  attempt: AcquisitionAttempt,
  operationId: string,
) {
  if (
    attempt.state !== "obsolete" ||
    !Settlement.safeParse(attempt.failure).success
  )
    return null;
  return unsubmitted(attempt, operationId)
    ? duplicateObsolete
    : ownershipConflict;
}

/** Only the new unsubmitted reservation is released. The original torrent remains owned. */
export async function settleCompensatedSeasonDuplicate(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt & { release: ReleaseCandidate },
  input: {
    operationId: string;
    infoHash: string;
    observed: TorrentObservation | null;
  },
) {
  if (attempt.state !== "reserved" || attempt.edition !== "default")
    return null;
  const source = ordinarySeasonSource(attempt.release, attempt.mediaIds);
  const { observed, operationId } = input;
  if (
    source === null ||
    (observed !== null && ownedTorrent(context, observed, attempt))
  )
    return null;
  const invocation = context.libraryManagement;
  invocation?.freshness.assertActive();
  const epoch = attempt.recoveryEpoch;
  if (observed === null) {
    const [prior] = await retainedCompensations(
      context,
      context.db,
      source,
      epoch,
    );
    return prior === undefined ? null : ownershipConflict;
  }
  return serializable(context.db, async (tx) => {
    invocation?.freshness.assertActive();
    await lockAcquisitionMedia(tx, source.coverage);
    const [prior, other] = await retainedCompensations(
      context,
      tx,
      source,
      epoch,
    );
    if (prior === undefined) return null;
    if (
      other !== undefined ||
      prior.torrent === null ||
      !ownsObservation(context, prior, observed) ||
      source.infoHash !== input.infoHash
    )
      return ownershipConflict;
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: source.coverage,
    });
    await lockEffectiveRequests(tx, source.coverage);
    if (!(await lockRuntimeAuthority(tx, epoch))) return ownershipConflict;
    // The serializable snapshot rejects a changed torrent when this lock is acquired.
    await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id = ${prior.torrent.id} FOR SHARE`;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    const settledReplay = readSettledSeasonDuplicate(current, operationId);
    if (settledReplay !== null) return settledReplay;
    if (
      current.state !== "reserved" ||
      current.releaseId !== source.releaseId ||
      current.recoveryEpoch !== epoch ||
      !sameCoverage(current.mediaIds, source.coverage) ||
      !unsubmitted(current, operationId)
    )
      return ownershipConflict;
    const seriesId = ordinaryIdentity(current, source, epoch);
    if (
      seriesId === null ||
      ordinaryIdentity(prior, source, epoch) !== seriesId ||
      !(await coversCurrentSeason(context, tx, source, seriesId))
    )
      return ownershipConflict;
    const released = await releaseDuplicate(tx, context, current, {
      source,
      operationId,
    });
    invocation?.freshness.assertActive();
    return released ? duplicateObsolete : ownershipConflict;
  });
}

type RetainedAttempt = Awaited<
  ReturnType<typeof retainedCompensations>
>[number];
function ownsObservation(
  context: MediaAutomationContext,
  prior: RetainedAttempt,
  observed: TorrentObservation,
) {
  const isolated = path.posix.join(context.downloadRoot, "media", prior.id);
  const content = path.posix.resolve(observed.content_path);
  return (
    observed.progress === 1 &&
    prior.torrent?.qbittorrentId === observed.hash &&
    prior.torrent.state !== "removing" &&
    path.posix.isAbsolute(observed.content_path) &&
    (content === isolated || content.startsWith(`${isolated}/`)) &&
    ownedTorrent(context, observed, prior)
  );
}

async function releaseDuplicate(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  { source, operationId }: { source: SeasonSource; operationId: string },
): Promise<boolean> {
  const generations = Object.entries(
    GenerationsSchema.parse(attempt.generations),
  );
  const epoch = attempt.recoveryEpoch;
  if (
    !sameCoverage(
      generations.map(([mediaId]) => mediaId),
      source.coverage,
    )
  )
    return false;
  const reservations = {
    attemptId: attempt.id,
    edition: "default",
    OR: generations.map(([mediaId, generation]) => ({
      mediaId,
      generation,
      target: { generation, automationEpoch: epoch },
    })),
  };
  const total = await tx.acquisitionReservation.count({
    where: { attemptId: attempt.id },
  });
  if (total !== source.coverage.length) return false;
  const commands = await tx.operation.findMany({
    where: { id: { in: [attempt.operationId, operationId] } },
    select: { id: true, targetId: true },
  });
  if (
    !commands.some(
      (command) =>
        command.id === operationId &&
        command.targetId !== null &&
        source.coverage.includes(command.targetId),
    )
  )
    return false;
  const changed = await tx.acquisitionAttempt.updateMany({
    where: {
      id: attempt.id,
      state: "reserved",
      recoveryEpoch: epoch,
      coordinatorOperationId: attempt.coordinatorOperationId,
      torrentId: null,
      filePlan: { equals: Prisma.DbNull },
    },
    data: { state: "obsolete", failure: { reason: duplicateObsolete.reason } },
  });
  if (changed.count !== 1) return false;
  const released = await tx.acquisitionReservation.deleteMany({
    where: reservations,
  });
  if (released.count !== source.coverage.length)
    throw new MediaError(
      "torrent_ownership_conflict",
      "Unsubmitted season reservations changed",
      409,
    );
  const primary = commands.find(
    (command) => command.id === attempt.operationId,
  )?.targetId;
  if (primary != null && source.coverage.includes(primary))
    await restoreServingEpisode(tx, context, primary);
  return true;
}

async function restoreServingEpisode(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  mediaId: string,
) {
  const invocation = context.libraryManagement;
  if (invocation === undefined) return;
  invocation.freshness.assertActive();
  const assets = await tx.assetCoverage.findMany({
    where: { mediaId, edition: "default", current: true },
    select: { assetId: true },
    take: 2,
  });
  const [asset] = assets;
  if (asset === undefined || assets.length !== 1) return;
  await bindPlexTransactionDeadline(tx, invocation.freshness);
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: defaultScope(mediaId),
      assetId: asset.assetId,
      access: invocation.access,
    },
    invocation.budget,
  );
  if (binding.status !== "current") return;
  invocation.freshness.assertActive();
  const projected = await tx.mediaItem.updateMany({
    where: { id: mediaId, kind: "episode", availability: "searching" },
    data: { availability: "available" },
  });
  if (projected.count === 1)
    await mirrorDefaultAvailability(tx, [mediaId], "available");
}
