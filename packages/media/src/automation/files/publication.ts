import { storedFilePath } from "./paths/locations.ts";
import {
  ownedSubtitleSidecars,
  advanceSubtitleBindings,
} from "./subtitle-lifecycle/ownership.ts";
import { z } from "zod";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
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
import { fileMovieAccess } from "#automation/editions/access.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { recoverObsoletePublication } from "./recovery.ts";
import { commitEmbedded } from "./embedded.ts";
import { resumeCommittedPublication } from "./committed-publication.ts";
import { prepareRecordedPublicationProof } from "#automation/publication-proof/embedded.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { producePublication } from "#automation/publication-proof/producer.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { compensateRecordedPublication } from "#automation/publication-proof/local-compensation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertPlanEdition } from "./editions/acquisition.ts";
import { libraryFileInvocation } from "#automation/acquisition-management/files.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  assertMeasuredUpgrade,
  storedMeasuredRelease,
} from "./quality-guard.ts";

export async function promote(
  initialContext: FileContext,
  attemptId: string,
): Promise<void> {
  const execution = initialContext.publicationExecution?.();
  execution?.assertActive();
  const budget =
    initialContext.libraryManagement?.budget ??
    new PublicationAuthorityReadBudget();
  if (
    await resumeCommittedPublication({
      context: initialContext,
      attemptId,
      budget,
      managedOnly: true,
      ...(execution === undefined ? {} : { execution }),
    })
  )
    return;
  if (!(await initialContext.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  if (
    await resumeCommittedPublication({
      context: initialContext,
      attemptId,
      budget,
      ...(execution === undefined ? {} : { execution }),
    })
  )
    return;
  const attempt = await initialContext.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const rawFilePlanHash = snapshotHash(nativeJson(attempt.filePlan));
  const movieAccess = await fileMovieAccess(initialContext, attempt.mediaIds);
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const context = await prepareRecordedPublicationProof(
    await libraryFileInvocation(
      publicationInvocation(
        initialContext,
        requirePublicationExecution(execution),
      ),
      attempt.identityEvidence,
      budget,
    ),
    plan,
    attemptId,
  );
  try {
    await producePublication({
      context,
      attempt,
      plan,
      rawFilePlanHash,
      authorizePlan: async (tx, current) => {
        await context.checkpoint("publication-authorization");
        if (!(await context.enabled.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        const choice = await assertAcquisition(tx, attemptId, {
          serverMachineId: context.serverMachineId,
          movieAccess,
          libraryManagement: context.libraryManagement,
        });
        await assertPlanEdition(tx, current, plan);
        return () => choice?.assertActive();
      },
      authorizeEntry: async (tx, current, entry) => {
        await context.checkpoint("publication-authorization");
        if (!(await context.enabled.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        await assertProfile(tx, entry);
        await assertPrevious(tx, entry, current.recoveryEpoch);
        await assertMeasuredUpgrade(
          tx,
          storedMeasuredRelease(entry.properties),
          entry.mediaIds,
          entry.assetId,
        );
      },
      commit: async (tx, entry) => {
        await commitPublication({
          tx,
          entry,
          context,
          torrentId: attempt.torrentId,
          recoveryEpoch: attempt.recoveryEpoch,
        });
        await commitEmbedded({
          context,
          tx,
          entry,
          recoveryEpoch: attempt.recoveryEpoch,
        });
      },
    });
  } catch (error) {
    if (
      !(error instanceof MovieChoiceProtection) &&
      (!(error instanceof FileGuardError) || !error.reason.includes("obsolete"))
    )
      throw error;
    if (await compensateRecordedPublication(context, attemptId, plan))
      throw error;
    await context.db.$transaction(
      async (tx) => {
        await lockAcquisitionMedia(tx, attempt.mediaIds);
        if (
          (await loadPublicationIntent(
            tx,
            attemptId,
            context.libraryManagement?.budget,
          )) !== null
        )
          throw new FileGuardError(
            "publication_recorded_compensation_required",
          );
        await recoverObsoletePublication({ context, tx, attemptId, plan });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    throw error;
  }
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

export async function commitPublication(input: {
  tx: Transaction;
  entry: FilePlanEntry;
  context: FileContext;
  torrentId: string | null;
  recoveryEpoch: number;
  movieScope?: MovieEditionScope;
}): Promise<void> {
  const { tx, entry, torrentId } = input;
  const scope =
    input.movieScope === undefined
      ? undefined
      : MovieEditionScopeSchema.parse(input.movieScope);
  if (
    scope !== undefined &&
    (entry.libraryKind !== "movies" ||
      entry.mediaIds.length !== 1 ||
      entry.mediaIds[0] !== scope.mediaId)
  )
    throw new FileGuardError("movie_publication_scope_changed");
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
        path: storedFilePath(
          input.context,
          entry.libraryKind,
          "control",
          `rollback/${entry.operationId}`,
        ),
        state: "superseded",
        supersededByAssetId: entry.assetId,
        version: { increment: 1 },
      },
    });
    for (const sidecar of entry.previousSidecars)
      await tx.subtitleAsset.update({
        where: { id: sidecar.subtitleId },
        data: {
          path: storedFilePath(
            input.context,
            entry.libraryKind,
            "control",
            `quarantine/${sidecar.quarantineId}`,
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
      edition: scope?.edition ?? "default",
      editionRootId:
        scope?.rootMediaId ?? (await defaultPhysicalRoot(tx, entry.mediaIds)),
      path: storedFilePath(
        input.context,
        entry.libraryKind,
        "library",
        entry.libraryPath,
      ),
      sourcePath: storedFilePath(
        input.context,
        entry.libraryKind,
        "downloads",
        entry.downloadPath,
      ),
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
    data: {
      ...(scope === undefined || scope.edition === "default"
        ? { availability: "importing" as const }
        : {}),
      version: { increment: 1 },
    },
  });
  if (scope === undefined)
    await mirrorDefaultAvailability(tx, entry.mediaIds, "importing");
  else
    await tx.mediaIntent.update({
      where: {
        mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
      },
      data: { availability: "importing" },
    });
  await tx.applicationEvent.createMany({
    data: entry.mediaIds.map((mediaId) => ({
      mediaId,
      kind: "files_published",
      payload: {
        ...(scope === undefined ? {} : { schemaVersion: 4, scope }),
        assetId: entry.assetId,
        previousAssetId: entry.previousAssetId,
      },
    })),
  });
}
