import path from "node:path";
import type { Prisma, Torrent } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import { loadSeriesPackInterpretationV1 } from "#infrastructure/acquisition-identity/series-pack/parent.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  TorrentObservation,
  TorrentFile,
} from "#integrations/qbittorrent.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import { CapturedSeriesPackV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import { seriesPackSourceSettlementV1 } from "./series-pack-settlement.ts";
import {
  seriesPackSourceLibraryOriginsV1,
  completedSeriesPackSourceGroupV1,
} from "./series-pack-origin.ts";

type Parent = NonNullable<
  Awaited<ReturnType<typeof loadSeriesPackPublicationRecordV1>>
>;

function completeServingPlan(
  settlement: NonNullable<
    Awaited<ReturnType<typeof seriesPackSourceSettlementV1>>
  >,
) {
  return (
    settlement.mode === "completed" ||
    settlement.plan.every((entry) => entry.previousAssetId !== null)
  );
}

function historicalSourceMatches(input: {
  parent: Parent;
  profileRules: unknown;
  interpreted: Awaited<ReturnType<typeof loadSeriesPackInterpretationV1>>;
  torrent: Torrent;
  observed: TorrentObservation;
}) {
  const { parent, profileRules, interpreted, torrent, observed } = input;
  return (
    identityHash(profileRules) === interpreted.value.profile.hash &&
    parent.attempt.releaseId === interpreted.source.id &&
    interpreted.source.providerId === torrent.providerId &&
    CandidateSourceEvidenceSchema.parse(interpreted.source.sourceEvidence)
      .infoHash === observed.hash
  );
}
function outside(physical: string, isolated: string) {
  const target = path.resolve(physical);
  return (
    target !== isolated &&
    !target.startsWith(`${isolated}/`) &&
    !isolated.startsWith(`${target}/`)
  );
}

function completeMembers(parent: Parent, files: TorrentFile[]) {
  const entries = parent.reference.intent.entries;
  return (
    files.length === entries.length &&
    entries.every(({ entry }) => {
      const source = entry.identityEvidence?.sourceFile;
      const observed = files.find(
        (file) => file.index === source?.torrentFileIndex,
      );
      return (
        source !== undefined &&
        observed?.name === source.relativePath &&
        String(observed.size) === source.sizeBytes &&
        observed.progress === 1
      );
    })
  );
}

function ownedSource(
  context: MediaAutomationContext,
  input: {
    parent: Parent;
    torrent: Torrent;
    observed: TorrentObservation;
    files: TorrentFile[];
  },
) {
  const { parent, torrent, observed, files } = input;
  return (
    parent.attempt.torrentId === torrent.id &&
    torrent.owned &&
    torrent.ownershipEpoch === parent.attempt.recoveryEpoch &&
    torrent.infoHash === observed.hash &&
    torrent.qbittorrentId === observed.hash &&
    ownedTorrent(context, observed, parent.attempt) &&
    completeMembers(parent, files)
  );
}

async function hasDependentInventory(
  tx: Prisma.TransactionClient,
  input: {
    ids: string[];
    mediaIds: string[];
    attemptId: string;
    completed: boolean;
    isolated: string;
  },
) {
  return (
    (await tx.assetCoverage.count({
      where: {
        assetId: { in: input.ids },
        OR: [
          ...(input.completed ? [] : [{ current: true }]),
          { mediaId: { notIn: input.mediaIds } },
          { edition: { not: "default" } },
        ],
      },
    })) !== 0 ||
    (await tx.acquisitionReservation.count({
      where: { attemptId: input.attemptId },
    })) !== 0 ||
    (await tx.subtitleReplacement.count({
      where: { assetId: { in: input.ids }, reservationActive: true },
    })) !== 0 ||
    (await tx.subtitleAsset.count({
      where: {
        assetId: { in: input.ids },
        OR: [
          { path: input.isolated },
          { path: { startsWith: `${input.isolated}/` } },
        ],
      },
    })) !== 0 ||
    (await tx.operation.count({
      where: {
        targetId: { in: input.ids },
        status: { in: ["queued", "running"] },
        kind: { not: "maintain_torrent" },
      },
    })) !== 0
  );
}

/** Complete, literal v3 lineage. Current operational absence checks never construct grant snapshots. */
export async function seriesPackSettledSourceCohortV1(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  input: {
    torrent: Torrent;
    attemptId: string;
    observed: TorrentObservation;
    files: TorrentFile[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const parent = await loadSeriesPackPublicationRecordV1(
    tx,
    input.attemptId,
    budget,
  );
  if (parent?.outcome == null) return null;
  const owner = parent.attempt;
  const identity = managedSeriesIdentity(owner.identityEvidence);
  const torrentId = input.torrent.id;
  if (
    identity === null ||
    !("seriesPackV1" in identity.source) ||
    !ownedSource(context, {
      parent,
      torrent: input.torrent,
      observed: input.observed,
      files: input.files,
    }) ||
    (await tx.acquisitionAttempt.count({ where: { torrentId } })) !== 1
  )
    return null;
  const sections = await context.permittedSections();
  if (
    context.serverMachineId !== identity.management.serverMachineId ||
    sections.series !== identity.management.sectionId
  )
    return null;
  await lockPublicationRows(tx, {
    attemptId: owner.id,
    mediaIds: owner.mediaIds,
    entries: parent.reference.intent.entries,
  });
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + identity.management.serverMachineId},0))::text`;
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
    !historicalSourceMatches({
      parent,
      profileRules: profile.rules,
      interpreted,
      torrent: input.torrent,
      observed: input.observed,
    })
  )
    return null;
  const settlement = await seriesPackSourceSettlementV1(tx, parent, budget);
  if (settlement === null) return null;
  const isolated = path.join(context.downloadRoot, "media", owner.id);
  const assets = await tx.libraryAsset.findMany({
    where: { torrentId },
    take: budget.take,
  });
  budget.consume(assets.length);
  if (
    assets.length !==
      (settlement.mode === "compensated" ? 0 : parent.outcome.entries.length) ||
    assets.some((asset) => {
      const after = parent.outcome?.entries.find(
        (row) => row.successor?.id === asset.id,
      )?.successor;
      return (
        after == null ||
        asset.state !==
          (settlement.mode === "completed" ? "published" : "rejected") ||
        asset.version !==
          after.version + (settlement.mode === "completed" ? 0 : 1) ||
        (settlement.mode === "completed" &&
          (asset.plexPublishedAt === null ||
            asset.plexPublishedAt.getTime() > Date.now())) ||
        !asset.owned ||
        asset.ownershipEpoch !== owner.recoveryEpoch ||
        asset.edition !== "default" ||
        asset.editionRootId !== identity.management.seriesId ||
        asset.checksum !== after.checksum ||
        asset.sizeBytes.toString() !== after.sizeBytes ||
        !outside(asset.path, isolated)
      );
    })
  )
    return null;
  // The paid original FilePlan/outcome binds source membership. These live NOT
  // EXISTS checks protect changed/dependent inventory without fabricating a
  // historical false-coverage snapshot or materializing a partial cohort.
  const ids = assets.map((asset) => asset.id);
  if (
    await hasDependentInventory(tx, {
      ids,
      mediaIds: owner.mediaIds,
      attemptId: owner.id,
      completed: settlement.mode === "completed",
      isolated,
    })
  )
    return null;
  const origins =
    settlement.mode === "completed"
      ? completedSeriesPackSourceGroupV1(parent)
      : await seriesPackSourceLibraryOriginsV1(
          tx,
          { identity, epoch: owner.recoveryEpoch, mode: settlement.mode },
          budget,
        );
  if (origins === null || !completeServingPlan(settlement)) return null;
  const inputs = settlement.plan.flatMap((entry) => {
    const assetId =
      settlement.mode === "completed" ? entry.assetId : entry.previousAssetId;
    return assetId === null
      ? []
      : entry.mediaIds.map((mediaId) => ({
          scope: { mediaId, edition: "default" as const },
          assetId,
          access: {
            serverMachineId: identity.management.serverMachineId,
            sectionId: identity.management.sectionId,
            sectionType: "show" as const,
          },
        }));
  });
  const serving = await readCurrentPlexBindings(tx, inputs, budget);
  if (
    serving.some((read) => {
      if (
        read.status !== "current" ||
        !outside(read.association.group.canonicalPath, isolated)
      )
        return true;
      const captured = parent.reference.intent.entries.find(
        ({ entry }) =>
          (settlement.mode === "completed"
            ? entry.assetId
            : entry.previousAssetId) === read.association.group.assetId,
      );
      return (
        captured === undefined ||
        !origins(read.association.group, captured.predecessor)
      );
    })
  )
    return null;
  return { owner, parent, identity, assets, isolated };
}
