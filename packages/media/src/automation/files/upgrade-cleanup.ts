import { Prisma } from "#generated/prisma/client.ts";
import { workerFilePath } from "./paths/locations.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import type { SubtitleAsset } from "#generated/prisma/client.ts";
import {
  ownedSubtitleSidecars,
  advanceSubtitleBindings,
} from "./subtitle-lifecycle/ownership.ts";
import { prepareContentProof } from "./content-proof.ts";
import {
  prepareUpgradeCleanupPlan,
  UpgradeCleanupPlanSchema,
  type UpgradeCleanupPlan,
} from "./upgrade-cleanup-plan.ts";
import { assertRuntime } from "./guards.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { captureCleanupPlex, lockCleanupPlex } from "./plex-binding/cleanup.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { videoSubtitleWhere } from "./subtitle-lifecycle/ownership.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import {
  assertLegacyClaimsResolved,
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { fileOperations } from "./file-operations.ts";
import {
  FileGuardError,
  now,
  type FileContext,
  type Transaction,
} from "./types.ts";
import {
  currentPlayback,
  playbackReferences,
  assertCurrentPlayback,
} from "./plex-binding/cleanup-playback.ts";

/** Deletes only the exact superseded version after its successor has been verified for seven days. */
export async function cleanupUpgrade(
  initialContext: FileContext,
  cleanupId: string,
  operationId: string,
): Promise<void> {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const execution = initialContext.publicationExecution?.();
  const snapshot = await initialContext.db.upgradeCleanup.findUniqueOrThrow({
    where: { id: cleanupId },
  });
  if (snapshot.state === "purged") return;
  if (snapshot.state === "cancelled")
    throw new FileGuardError("cleanup_cancelled");
  if (snapshot.state !== "pending")
    throw new FileGuardError("cleanup_state_protected");
  const runtime = await initialContext.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.recoveryEpoch !== snapshot.recoveryEpoch)
    throw new FileGuardError("runtime_protected");
  if (!(await initialContext.enabled.purge()))
    throw new FileGuardError("purge_disabled");
  if (snapshot.expiresAt > now(initialContext))
    throw new FileGuardError("rollback_window_incomplete");
  const invocation = publicationInvocation(
    initialContext,
    requirePublicationExecution(execution),
  );
  const proof = await captureCleanupPlex(
    invocation,
    { cleanupId, operationId },
    observed,
  );
  if (proof === null) return;
  const plan = await prepareUpgradeCleanupPlan(invocation, cleanupId);
  proof.freshness.assertActive();
  const mediaIds = proof.evidence.expected.mediaIds;
  if (await reopenLegacyClaimProtection(initialContext.db, mediaIds))
    throw new PendingLegacyClaimsError(mediaIds);
  const intents = proof.evidence.expected.targets;
  const generations = new Map(
    intents.map((intent) => [intent.mediaId, intent.generation]),
  );
  const playback = await currentPlayback(invocation, plan.mediaIds);
  proof.freshness.assertActive();
  const access = [
    ...new Map(
      playback.map((item) => [item.access.sectionType, item.access]),
    ).values(),
  ].sort((a, b) => a.sectionType.localeCompare(b.sectionType));
  const context = await prepareContentProof(invocation, [
    ...plan.files.map((file) => ({
      libraryKind: plan.libraryKind,
      root: "control" as const,
      path: `${file.location}/${file.id}`,
    })),
    ...playbackReferences(initialContext, plan.libraryKind, playback),
  ]);
  proof.freshness.assertActive();
  await context.db.$transaction(
    async (tx) => {
      const freshness = await lockCleanupPlex(tx, {
        context: { ...context, execution: invocation.execution },
        proof,
        plan,
        access,
      });
      if (freshness === null) return;
      const current = await tx.upgradeCleanup.findUniqueOrThrow({
        where: { id: cleanupId },
      });
      if (current.state === "purged") return;
      const authorize = async () => {
        await assertPublicationUnfenced(tx, mediaIds, [
          current.assetId,
          current.successorAssetId,
          ...playback.map((item) => item.id),
        ]);
        await assertDefaultPhysicalAsset(tx, current.assetId);
        await assertDefaultPhysicalAsset(tx, current.successorAssetId);
        if (!(await context.enabled.purge()))
          throw new FileGuardError("purge_disabled");
        await assertRuntime(tx, snapshot.recoveryEpoch);
        await assertLegacyClaimsResolved(tx, mediaIds);
        if (
          !(await recordsAuthorized(tx, {
            epoch: snapshot.recoveryEpoch,
            mediaIds,
            assetIds: [
              current.assetId,
              current.successorAssetId,
              ...playback.map((item) => item.id),
            ],
          }))
        )
          throw new FileGuardError("record_ownership_unconfirmed");
        if (
          await tx.recoveryHold.count({
            where: {
              mediaId: { in: mediaIds },
              edition: "default",
              releasedAt: null,
            },
          })
        )
          throw new FileGuardError("recovery_request_history_unconfirmed");
        if (
          current.state !== "pending" ||
          current.recoveryEpoch !== snapshot.recoveryEpoch ||
          current.expiresAt.getTime() !== snapshot.expiresAt.getTime() ||
          JSON.stringify(UpgradeCleanupPlanSchema.parse(current.manifest)) !==
            JSON.stringify(plan)
        )
          throw new FileGuardError("cleanup_plan_changed");
        await assertCleanupAssets({ tx, context, cleanup: current, plan });
        await assertCurrentPlayback(tx, context, playback, freshness);
        const latest = await tx.mediaIntent.findMany({
          where: { mediaId: { in: mediaIds }, edition: "default" },
        });
        if (
          latest.length !== mediaIds.length ||
          latest.some(
            (intent) => intent.generation !== generations.get(intent.mediaId),
          )
        )
          throw new FileGuardError("cleanup_generation_changed");
        const held = await tx.retentionHold.count({
          where: {
            mediaId: { in: mediaIds },
            edition: "default",
            OR: [
              { isPin: true },
              { until: null },
              { until: { gt: now(context) } },
            ],
          },
        });
        if (held !== 0) throw new FileGuardError("cleanup_media_held");
        await assertNoRecoveryReference(tx, current.assetId);
        freshness.assertActive();
      };
      await authorize();
      const operations = fileOperations(
        context,
        context.roots[plan.libraryKind],
        authorize,
        freshness.assertActive,
      );
      for (const file of plan.files) {
        if (context.contentProof === undefined)
          throw new Error("Cleanup proof missing");
        if (
          (await context.contentProof.digest(
            workerFilePath(context, file.path),
          )) !== null
        )
          continue;
        const journal = await operations.readManifest(
          `upgrade-purge-${cleanupId}-${file.id}`,
        );
        if (
          journal?.kind !== "purge" ||
          journal.source !== workerFilePath(context, file.path) ||
          journal.target !== workerFilePath(context, file.path) ||
          journal.sha256 !== file.checksum
        )
          throw new FileGuardError("cleanup_missing_unproven");
      }
      for (const file of plan.files)
        await operations.purge({
          operationId: `upgrade-purge-${cleanupId}-${file.id}`,
          quarantineId: file.id,
          sha256: file.checksum,
          location: file.location,
        });
      const purgedAsset = await tx.libraryAsset.update({
        where: { id: current.assetId },
        data: { state: "purged", version: { increment: 1 } },
      });
      if (purgedAsset.checksum === null)
        throw new Error("Cleanup video checksum missing");
      await advanceSubtitleBindings(tx, {
        assetId: purgedAsset.id,
        checksum: purgedAsset.checksum,
        epoch: snapshot.recoveryEpoch,
        fromVersion: plan.assetVersion,
        toVersion: purgedAsset.version,
        fromState: "superseded",
        sidecarIds: plan.files.flatMap((file) =>
          file.subtitleId === null ? [] : [file.subtitleId],
        ),
        state: "purged",
      });
      await tx.upgradeCleanup.update({
        where: { id: cleanupId },
        data: { state: "purged", version: { increment: 1 } },
      });
      await tx.applicationEvent.create({
        data: {
          kind: "upgrade_rollback_expired",
          payload: { cleanupId, assetId: current.assetId },
        },
      });
      freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function assertCleanupAssets(input: {
  tx: Transaction;
  context: FileContext;
  cleanup: { assetId: string; successorAssetId: string; expiresAt: Date };
  plan: UpgradeCleanupPlan;
}): Promise<void> {
  const { tx, context, cleanup, plan } = input;
  await assertNoSubtitleReplacement(tx, [
    cleanup.assetId,
    cleanup.successorAssetId,
  ]);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join([cleanup.assetId, cleanup.successorAssetId].sort())}) ORDER BY id FOR UPDATE`,
  );
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.assetId },
    include: { coverage: true, subtitles: { where: videoSubtitleWhere } },
  });
  const successor = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.successorAssetId },
    include: {
      coverage: { where: { current: true }, include: { media: true } },
    },
  });
  const video = plan.files.find((file) => file.subtitleId === null);
  if (
    video === undefined ||
    !asset.owned ||
    asset.state !== "superseded" ||
    asset.version !== plan.assetVersion ||
    asset.path !== video.path ||
    asset.checksum !== video.checksum ||
    asset.supersededByAssetId !== successor.id ||
    asset.rollbackExpiresAt?.getTime() !== cleanup.expiresAt.getTime() ||
    asset.coverage.some((coverage) => coverage.current)
  )
    throw new FileGuardError("cleanup_asset_changed");
  if (
    !successor.owned ||
    !["published", "superseded", "purged"].includes(successor.state) ||
    successor.checksum !== plan.successorChecksum ||
    successor.plexPublishedAt === null ||
    cleanup.expiresAt.getTime() !==
      successor.plexPublishedAt.getTime() + 7 * 86_400_000 ||
    cleanup.expiresAt > now(context)
  )
    throw new FileGuardError("cleanup_successor_unverified");
  if (
    asset.coverage.length !== plan.mediaIds.length ||
    asset.coverage.some((coverage) => !plan.mediaIds.includes(coverage.mediaId))
  )
    throw new FileGuardError("cleanup_coverage_changed");
  await assertSidecars(tx, asset, plan);
  ownedSubtitleSidecars(asset);
}

async function assertSidecars(
  tx: Transaction,
  asset: { id: string; subtitles: SubtitleAsset[] },
  plan: UpgradeCleanupPlan,
): Promise<void> {
  const subtitleIds = plan.files.flatMap((file) =>
    file.subtitleId === null ? [] : [file.subtitleId],
  );
  if (
    asset.subtitles.some(
      (subtitle) =>
        subtitle.path !== null && !subtitleIds.includes(subtitle.id),
    )
  )
    throw new FileGuardError("cleanup_sidecar_changed");
  for (const file of plan.files) {
    if (
      file.subtitleId !== null &&
      !asset.subtitles.some(
        (subtitle) =>
          subtitle.id === file.subtitleId &&
          subtitle.state === "superseded" &&
          subtitle.path === file.path &&
          subtitle.checksum === file.checksum,
      )
    )
      throw new FileGuardError("cleanup_sidecar_changed");
    const shared = await tx.subtitleAsset.count({
      where: { path: file.path, id: { notIn: subtitleIds } },
    });
    const libraryReferences = await tx.libraryAsset.count({
      where: { path: file.path, id: { not: asset.id } },
    });
    if (shared !== 0 || libraryReferences !== 0)
      throw new FileGuardError("cleanup_shared_path");
  }
}

async function assertNoRecoveryReference(
  tx: Transaction,
  assetId: string,
): Promise<void> {
  const attempts = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "AcquisitionAttempt" WHERE state NOT IN ('completed', 'obsolete', 'rolled_back') AND ("filePlan" @> ${JSON.stringify([{ assetId }])}::jsonb OR "filePlan" @> ${JSON.stringify([{ previousAssetId: assetId }])}::jsonb) LIMIT 1`;
  if (attempts.length > 0)
    throw new FileGuardError("cleanup_recovery_dependency");
  const decisions = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "RetentionDecision" WHERE state IN ('grace_period', 'cancelled', 'quarantined') AND manifest @> ${JSON.stringify({ assets: [{ assetId }] })}::jsonb LIMIT 1`;
  if (decisions.length > 0)
    throw new FileGuardError("cleanup_retention_dependency");
}
