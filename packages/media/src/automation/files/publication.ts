import nodePath from "node:path";
import {
  ownedSubtitleSidecars,
  advanceSubtitleBindings,
} from "./subtitle-lifecycle/ownership.ts";
import { z } from "zod";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import {
  defaultPhysicalRoot,
  assertDefaultPhysicalAsset,
} from "#infrastructure/handoff/default-edition.ts";
import { Prisma } from "#generated/prisma/client.ts";
import {
  FileGuardError,
  FilePlanSchema,
  type FileContext,
  type Transaction,
  type FilePlanEntry,
} from "./types.ts";
import { assertAcquisition } from "./guards.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { importDescriptor } from "./inspection.ts";
import { fileOperations } from "./file-operations.ts";
import { recoverObsoletePublication } from "./recovery.ts";
import { commitEmbedded } from "./embedded.ts";
import { resumeCommittedPublication } from "./committed-publication.ts";
import { preparePublicationProof } from "./content-proof.ts";
import { assertPlanEdition } from "./editions/acquisition.ts";
import {
  assertMeasuredUpgrade,
  storedMeasuredRelease,
} from "./quality-guard.ts";

export async function promote(
  initialContext: FileContext,
  attemptId: string,
): Promise<void> {
  if (!(await initialContext.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  if (await resumeCommittedPublication({ context: initialContext, attemptId }))
    return;
  const attempt = await initialContext.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const context = await preparePublicationProof(initialContext, plan);
  const result = await context.db.$transaction(
    async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (current.state === "imported") return "resume_committed";
      try {
        await assertAcquisition(tx, attemptId, context.serverMachineId);
        await assertPlanEdition(tx, current, plan);
        for (const entry of plan) await assertProfile(tx, entry);
      } catch (error) {
        if (
          !(error instanceof FileGuardError) ||
          !error.reason.includes("obsolete")
        )
          throw error;
        await recoverObsoletePublication({ context, tx, attemptId, plan });
        return error.reason;
      }
      for (const entry of plan) {
        const authorize = async () => {
          await context.checkpoint("publication-authorization");
          if (!(await context.enabled.acquisition()))
            throw new FileGuardError("acquisition_disabled");
          await assertAcquisition(tx, attemptId, context.serverMachineId);
          await assertPlanEdition(tx, current, plan);
          await assertProfile(tx, entry);
          await assertPrevious(tx, entry, current.recoveryEpoch);
          await assertMeasuredUpgrade(
            tx,
            storedMeasuredRelease(entry.properties),
            entry.mediaIds,
            entry.assetId,
          );
        };
        await authorize();
        const roots = context.roots[entry.libraryKind];
        const operations = fileOperations(context, roots, authorize);
        for (const sidecar of entry.previousSidecars) {
          await operations.quarantine({
            operationId: sidecar.operationId,
            libraryPath: sidecar.libraryPath,
            quarantineId: sidecar.quarantineId,
            sha256: sidecar.checksum,
          });
        }
        await operations.importFile(importDescriptor(entry));
        await commitPublication({
          tx,
          entry,
          roots,
          torrentId: attempt.torrentId,
          recoveryEpoch: current.recoveryEpoch,
        });
        await commitEmbedded({
          context,
          tx,
          entry,
          recoveryEpoch: attempt.recoveryEpoch,
        });
      }
      await tx.acquisitionAttempt.update({
        where: { id: attemptId },
        data: { state: "imported" },
      });
      return null;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  if (result === "resume_committed") {
    if (!(await resumeCommittedPublication({ context, attemptId })))
      throw new FileGuardError("committed_plan_changed");
  } else if (result !== null) throw new FileGuardError(result);
}

async function assertProfile(
  tx: Transaction,
  entry: FilePlanEntry,
): Promise<void> {
  const properties = z
    .object({ profileVersions: z.record(z.string(), z.number().int()) })
    .parse(entry.properties);
  for (const mediaId of entry.mediaIds) {
    const intent = await tx.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(mediaId)),
    });
    if (intent.profileId === null) throw new FileGuardError("profile_missing");
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "QualityProfile" WHERE id = ${intent.profileId} FOR SHARE`,
    );
    const profile = await tx.qualityProfile.findUniqueOrThrow({
      where: { id: intent.profileId },
    });
    if (
      profile.version !== properties.profileVersions[mediaId] ||
      intent.generation !== entry.generations[mediaId]
    )
      throw new FileGuardError("profile_obsolete");
  }
}

async function assertPrevious(
  tx: Transaction,
  entry: FilePlanEntry,
  recoveryEpoch: number,
): Promise<void> {
  const published = await tx.libraryAsset.findUnique({
    where: { id: entry.assetId },
  });
  if (published !== null) {
    await assertDefaultPhysicalAsset(tx, published.id);
    if (published.edition !== "default")
      throw new FileGuardError("edition_not_available");
    if (
      published.checksum !== entry.checksum ||
      !published.owned ||
      published.ownershipEpoch !== recoveryEpoch ||
      published.state !== "published"
    )
      throw new FileGuardError("publication_conflict");
    return;
  }
  const current = await tx.assetCoverage.findMany({
    where: {
      mediaId: { in: entry.mediaIds },
      edition: "default",
      current: true,
    },
    include: {
      asset: { include: { subtitles: { where: { state: "installed" } } } },
    },
  });
  if (entry.previousAssetId === null) {
    if (current.length > 0) throw new FileGuardError("asset_version_changed");
  } else if (
    current.length !== entry.mediaIds.length ||
    current.some(
      (coverage) =>
        coverage.assetId !== entry.previousAssetId ||
        coverage.asset.version !== entry.previousVersion ||
        coverage.asset.checksum !== entry.previousChecksum ||
        !coverage.asset.owned,
    )
  )
    throw new FileGuardError("asset_version_changed");
  if (
    current.some((coverage) => coverage.asset.ownershipEpoch !== recoveryEpoch)
  )
    throw new FileGuardError("asset_ownership_unconfirmed");
  if (
    current.some(
      (coverage) =>
        z
          .object({ handoffSidecarsUnresolved: z.boolean().optional() })
          .parse(coverage.asset.properties).handoffSidecarsUnresolved === true,
    )
  )
    throw new FileGuardError("sidecar_ownership_unconfirmed");
  const previous = current[0]?.asset;
  if (previous !== undefined) {
    await assertDefaultPhysicalAsset(tx, previous.id);
    const sidecars = ownedSubtitleSidecars(previous);
    if (
      sidecars.length !== entry.previousSidecars.length ||
      entry.previousSidecars.some(
        (item) =>
          !sidecars.some(
            (subtitle) =>
              subtitle.id === item.subtitleId &&
              subtitle.checksum === item.checksum,
          ),
      )
    )
      throw new FileGuardError("subtitle_manifest_changed");
  }
}

async function commitPublication(input: {
  tx: Transaction;
  entry: FilePlanEntry;
  roots: FileContext["roots"]["movies"];
  torrentId: string | null;
  recoveryEpoch: number;
}): Promise<void> {
  const { tx, entry, roots, torrentId } = input;
  if (
    (await tx.libraryAsset.findUnique({ where: { id: entry.assetId } })) !==
    null
  )
    return;
  if (entry.previousAssetId !== null) {
    if (entry.previousChecksum === null || entry.previousVersion === null)
      throw new FileGuardError("previous_asset_unproven");
    await tx.assetCoverage.updateMany({
      where: { assetId: entry.previousAssetId, current: true },
      data: { current: false },
    });
    await tx.libraryAsset.update({
      where: { id: entry.previousAssetId },
      data: {
        path: nodePath.join(roots.control, "rollback", entry.operationId),
        state: "superseded",
        supersededByAssetId: entry.assetId,
        version: { increment: 1 },
      },
    });
    for (const sidecar of entry.previousSidecars)
      await tx.subtitleAsset.update({
        where: { id: sidecar.subtitleId },
        data: {
          path: nodePath.join(
            roots.control,
            "quarantine",
            sidecar.quarantineId,
          ),
        },
      });
    await advanceSubtitleBindings(tx, {
      assetId: entry.previousAssetId,
      checksum: entry.previousChecksum,
      epoch: input.recoveryEpoch,
      fromVersion: entry.previousVersion,
      toVersion: entry.previousVersion + 1,
      fromState: "installed",
      sidecarIds: entry.previousSidecars.map((item) => item.subtitleId),
      state: "superseded",
    });
  }
  await tx.libraryAsset.create({
    data: {
      id: entry.assetId,
      edition: "default",
      editionRootId: await defaultPhysicalRoot(tx, entry.mediaIds),
      path: nodePath.join(roots.library, entry.libraryPath),
      sourcePath: nodePath.join(roots.downloads, entry.downloadPath),
      torrentId,
      sizeBytes: BigInt(entry.sizeBytes),
      checksum: entry.checksum,
      properties: entry.properties ?? Prisma.JsonNull,
      owned: true,
      ownershipEpoch: input.recoveryEpoch,
      state: "published",
      coverage: {
        create: entry.mediaIds.map((mediaId) => ({ mediaId, current: true })),
      },
    },
  });
  await tx.mediaItem.updateMany({
    where: { id: { in: entry.mediaIds } },
    data: { availability: "importing", version: { increment: 1 } },
  });
  await mirrorDefaultAvailability(tx, entry.mediaIds, "importing");
  await tx.applicationEvent.createMany({
    data: entry.mediaIds.map((mediaId) => ({
      mediaId,
      kind: "files_published",
      payload: {
        assetId: entry.assetId,
        previousAssetId: entry.previousAssetId,
      },
    })),
  });
}
