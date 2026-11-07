import path from "node:path";
import { z } from "zod";
import type { Prisma, Torrent } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readSeriesPackNativePublicationV1 } from "#infrastructure/native-compensation/series-pack/publication/record.ts";
import { SeriesPackNativeSeedCommandV1Schema } from "#shared/native-recovery/series-pack/source.ts";
import { CapturedSeriesPackV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import { loadSeriesPackInterpretationV1 } from "#infrastructure/acquisition-identity/series-pack/parent.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import type {
  TorrentObservation,
  TorrentFile,
} from "#integrations/qbittorrent.ts";

type Publication = NonNullable<
  Awaited<ReturnType<typeof readSeriesPackNativePublicationV1>>
>;
type SourceInput = {
  parent: NonNullable<
    Awaited<ReturnType<typeof nativeSeriesPackSourceParentV1>>
  >;
  torrent: Torrent;
  observed: TorrentObservation;
  files: TorrentFile[];
};

function ownedNativeSource(
  context: MediaAutomationContext,
  input: SourceInput,
) {
  const { publication } = input.parent;
  const owner = publication.record.publication.attempt;
  return (
    owner.torrentId === input.torrent.id &&
    input.torrent.owned &&
    input.torrent.ownershipEpoch === owner.recoveryEpoch &&
    input.torrent.infoHash === input.observed.hash &&
    input.torrent.qbittorrentId === input.observed.hash &&
    ownedTorrent(context, input.observed, owner) &&
    exactMembers(publication, input.files)
  );
}

function outside(filename: string, isolated: string) {
  const actual = path.resolve(filename);
  return (
    actual !== isolated &&
    !actual.startsWith(`${isolated}/`) &&
    !isolated.startsWith(`${actual}/`)
  );
}

function exactMembers(publication: Publication, files: readonly TorrentFile[]) {
  const entries = publication.record.publication.reference.intent.entries;
  return (
    files.length === entries.length &&
    entries.every(({ entry }) => {
      const source = entry.identityEvidence?.sourceFile;
      const actual = files.find(
        (file) => file.index === source?.torrentFileIndex,
      );
      return (
        source !== undefined &&
        actual?.name === source.relativePath &&
        String(actual.size) === source.sizeBytes &&
        actual.progress === 1
      );
    })
  );
}

export async function nativeSeriesPackSourceParentV1(
  tx: Prisma.TransactionClient,
  input: { continuationId: string; operationId: string; torrentId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const row =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  budget.consume(1);
  if (row.publicationCoordinatorOperationId === null) return null;
  const publication = await readSeriesPackNativePublicationV1(
    tx,
    {
      schemaVersion: 1,
      continuationId: row.id,
      operationId: row.publicationCoordinatorOperationId,
      recoveryEpoch: row.recoveryEpoch,
    },
    budget,
  );
  if (publication === null) return null;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const command = SeriesPackNativeSeedCommandV1Schema.parse(operation.payload);
  const source = command.seriesPackNativeSourceV1;
  if (
    operation.kind !== command.kind ||
    operation.id !== command.operationId ||
    operation.id !== input.operationId ||
    operation.targetId !== input.torrentId ||
    command.torrentId !== input.torrentId ||
    operation.userId !== publication.record.row.receipt.actorId ||
    operation.idempotencyKey !==
      `native-series-pack-source-v1:${row.id}:${input.torrentId}` ||
    source.continuationId !== row.id ||
    source.descriptorHash !== publication.record.row.descriptorHash ||
    source.recoveryEpoch !== publication.record.row.recoveryEpoch ||
    command.recoveryEpoch !== source.recoveryEpoch ||
    source.originalAttemptId !== publication.record.publication.attempt.id ||
    source.completionHash !== publication.proof.completionHash ||
    source.publicationHash !== identityHash(publication.proof) ||
    publication.record.publication.attempt.torrentId !== input.torrentId
  )
    throw new Error(
      "Native pack source command lost its actual serving/approval/original torrent parents",
    );
  return { publication, operation, command };
}

async function noPendingDependencies(
  tx: Prisma.TransactionClient,
  input: {
    assets: string[];
    mediaIds: string[];
    attemptId: string;
    torrentId: string;
    epoch: number;
    isolated: string;
  },
) {
  return (
    (await tx.acquisitionReservation.count({
      where: { attemptId: input.attemptId },
    })) === 0 &&
    (await tx.libraryAsset.count({ where: { torrentId: input.torrentId } })) ===
      0 &&
    (await tx.acquisitionAttempt.count({
      where: {
        id: { not: input.attemptId },
        mediaIds: { hasSome: input.mediaIds },
        state: { notIn: ["completed", "cancelled", "obsolete", "rolled_back"] },
      },
    })) === 0 &&
    (await tx.subtitleReplacement.count({
      where: { assetId: { in: input.assets }, reservationActive: true },
    })) === 0 &&
    (await tx.subtitleAsset.count({
      where: {
        assetId: { in: input.assets },
        OR: [
          { path: input.isolated },
          { path: { startsWith: `${input.isolated}/` } },
        ],
      },
    })) === 0 &&
    (await tx.operation.count({
      where: {
        targetId: { in: input.assets },
        status: { in: ["queued", "running"] },
        kind: { not: "maintain_torrent" },
        payload: { path: ["recoveryEpoch"], equals: input.epoch },
      },
    })) === 0
  );
}

/** Complete current independence, once under the actual whole native locks.
 * Immutable approval/serving/source parents are paid; SQL's separately bounded
 * full inventory equality returns no fabricated snapshot rows. */
export async function nativeSeriesPackSourceCohortV1(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  input: SourceInput,
  budget: PublicationAuthorityReadBudget,
) {
  const { publication } = input.parent;
  const { record } = publication;
  const owner = record.publication.attempt;
  const identity = managedSeriesIdentity(owner.identityEvidence);
  const completion = record.completion;
  const isolated = path.join(context.downloadRoot, "media", owner.id);
  if (
    completion === null ||
    identity === null ||
    !("seriesPackV1" in identity.source) ||
    !ownedNativeSource(context, input) ||
    (await tx.acquisitionAttempt.count({
      where: { torrentId: input.torrent.id },
    })) !== 1
  )
    return null;
  const sections = await context.permittedSections();
  const serverMachineId = context.serverMachineId;
  if (
    serverMachineId === undefined ||
    sections.series !== identity.management.sectionId ||
    serverMachineId !== identity.management.serverMachineId
  )
    return null;
  const interpreted = await loadSeriesPackInterpretationV1(
    tx,
    CapturedSeriesPackV1Schema.parse(identity.source.seriesPackV1),
    budget,
  );
  const profile = await tx.qualityProfileVersion.findUniqueOrThrow({
    where: {
      profileId_version: {
        profileId: interpreted.value.profile.id,
        version: interpreted.value.profile.version,
      },
    },
  });
  budget.consume(1);
  if (
    identityHash(profile.rules) !== interpreted.value.profile.hash ||
    owner.releaseId !== interpreted.source.id ||
    interpreted.source.providerId !== input.torrent.providerId ||
    CandidateSourceEvidenceSchema.parse(interpreted.source.sourceEvidence)
      .infoHash !== input.observed.hash
  )
    return null;
  const approvingOwner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: record.row.receipt.actorId },
  });
  budget.consume(1);
  if (approvingOwner.role !== "owner" || approvingOwner.restricted) return null;
  await assertLegacyClaimsResolved(tx, record.row.mediaIds, budget);
  await assertNativeStorageRoots(
    tx,
    record.descriptor.scope.storageRoots,
    budget,
  );
  await tx.$queryRaw`SELECT media_series_pack_native_current_bindings_v1(${z.json().parse(completion)}::jsonb)::text`;
  const bindings = completion.predecessorBindings;
  if (
    bindings.some(
      ({ after }) =>
        !outside(after.path, isolated) ||
        after.subtitles.some(
          (subtitle) =>
            subtitle.path !== null && !outside(subtitle.path, isolated),
        ),
    ) ||
    completion.retainedArtifacts.some(
      (artifact) => artifact.physical.root !== "control",
    ) ||
    !(await noPendingDependencies(tx, {
      assets: record.row.assetIds,
      mediaIds: record.row.mediaIds,
      attemptId: owner.id,
      torrentId: input.torrent.id,
      epoch: record.row.recoveryEpoch,
      isolated,
    }))
  )
    return null;
  const serving = await readCurrentPlexBindings(
    tx,
    bindings.flatMap(({ after }) =>
      after.coverage
        .filter((item) => item.current)
        .map(({ mediaId }) => ({
          scope: { mediaId, edition: "default" as const },
          assetId: after.id,
          access: {
            serverMachineId,
            sectionId: identity.management.sectionId,
            sectionType: "show" as const,
          },
        })),
    ),
    budget,
  );
  if (
    serving.length !== record.row.mediaIds.length ||
    serving.some((read) => {
      if (read.status !== "current") return true;
      const actual = read.association.group;
      const binding = bindings.find(({ after }) => after.id === actual.assetId);
      return (
        actual.assetVersion !== binding?.after.version ||
        actual.ownershipEpoch !== binding.after.ownershipEpoch ||
        actual.checksum !== binding.after.checksum ||
        actual.canonicalPath !== binding.after.path ||
        actual.sizeBytes !== binding.after.sizeBytes ||
        !outside(actual.canonicalPath, isolated)
      );
    })
  )
    return null;
  return { owner, isolated, epoch: record.row.recoveryEpoch };
}
