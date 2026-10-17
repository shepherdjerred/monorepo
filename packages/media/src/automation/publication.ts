import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import {
  publicationAwait,
  type CompensationPublicationPort,
} from "./publication/execution.ts";
import { verifiedPublicationItems } from "./publication/verified.ts";
import { findPublished, publicationSections } from "./publication/plex.ts";
import { publicationMatchesReceipt } from "./publication/receipt.ts";
import {
  beforePublicationRefresh,
  lockPublicationScope,
} from "./publication/fence.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { defaultScope, assertDefaultEdition } from "#shared/editions/scope.ts";
import { requireActiveRuntime } from "./runtime.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { queueCurrentSubtitleTargets } from "./subtitles/queue.ts";
import { recordVerifiedPublication } from "./reconciliation/upgrade-cleanup.ts";
import { publishRollback } from "./reconciliation/rollback-publication.ts";
import { queuePublicationNotifications } from "./notifications/events.ts";
import { queueSharedPublication } from "./notifications/shared.ts";
import { nativeRestorePublication } from "#infrastructure/native-quarantine/publication.ts";
import {
  publicationCoverageInclude,
  publicationLineageResolved,
  publicationGenerationMatches,
  samePublicationEvidence,
  assertDefaultPublicationCoverage,
} from "./reconciliation/publication-evidence.ts";

type PublicationActivities = Pick<
  MediaNetworkActivities,
  | "publishMediaToPlex"
  | "publishRolledBackMedia"
  | "publishRestoredMedia"
  | "finalizeMediaAcquisition"
>;

export function createPublicationActivities(
  context: MediaAutomationContext,
): PublicationActivities {
  return {
    publishRolledBackMedia: async (input) =>
      publishRollback(context, input, (mediaIds, proof) =>
        publishCoverage(context, mediaIds, input.operationId, proof),
      ),
    async publishRestoredMedia(input) {
      const intent = await context.db.mediaIntent.findUniqueOrThrow({
        where: targetWhere(defaultScope(input.mediaId)),
      });
      if (intent.generation !== input.generation)
        return { status: "blocked", reason: "intent_changed" };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      if (operation.kind === "restore_native_quarantine") {
        const restored = z
          .object({ restoreReceipt: z.unknown() })
          .parse(operation.result);
        const receipt = await nativeRestorePublication(
          context.db,
          operation.id,
          restored.restoreReceipt,
        );
        if (!receipt.mediaIds.includes(input.mediaId))
          throw new Error("Native restore receipt omitted requested media");
        return publishCoverage(context, receipt.mediaIds, input.operationId, {
          epoch: receipt.recoveryEpoch,
          receipt,
          requiredGenerations: receipt.generations,
        });
      }
      const receipt = RestoreReceiptSchema.parse(
        operation.result,
      ).restoreReceipt;
      if (!receipt.mediaIds.includes(input.mediaId))
        throw new Error("Restore receipt does not cover requested media");
      const decision = await context.db.retentionDecision.findUniqueOrThrow({
        where: { id: receipt.decisionId },
      });
      assertDefaultEdition(decision.edition);
      const runtime = await requireActiveRuntime(context.db);
      return decision.state !== "restored" ||
        !runtime.active ||
        runtime.epoch !== receipt.recoveryEpoch
        ? { status: "blocked", reason: "restore_evidence_obsolete" }
        : publishCoverage(context, receipt.mediaIds, input.operationId, {
            epoch: receipt.recoveryEpoch,
            receipt,
          });
    },
    async publishMediaToPlex(input) {
      const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      assertDefaultEdition(attempt.edition);
      return publishCoverage(context, attempt.mediaIds, input.operationId, {
        epoch: attempt.recoveryEpoch,
        notificationAttemptId: attempt.id,
        requiredGenerations: z
          .record(z.string(), z.number().int().nonnegative())
          .parse(attempt.generations),
      });
    },
    async finalizeMediaAcquisition(input) {
      await finalize(context, input.attemptId);
    },
  };
}

const RestoreReceiptSchema = z.object({
  restoreReceipt: z.object({
    decisionId: z.string(),
    mediaIds: z.array(z.string()).min(1),
    recoveryEpoch: z.number().int(),
    assets: z
      .array(
        z.object({
          assetId: z.string(),
          assetVersion: z.number().int(),
          checksum: z.string(),
        }),
      )
      .min(1),
  }),
});

type PublicationProof = {
  epoch: number;
  notificationAttemptId?: string;
  receipt?: Pick<
    z.infer<typeof RestoreReceiptSchema>["restoreReceipt"],
    "mediaIds" | "assets"
  >;
  requiredGenerations?: Readonly<Record<string, number>>;
  releaseAttemptId?: string;
  compensation?: CompensationPublicationPort;
};

export async function publishCoverage(
  context: MediaAutomationContext,
  mediaIds: string[],
  operationId: string,
  proof: PublicationProof,
): ReturnType<PublicationActivities["publishMediaToPlex"]> {
  try {
    return await publishCoverageChecked(context, mediaIds, operationId, proof);
  } catch (error) {
    if (error instanceof NativeCompensationProtection)
      return { status: "blocked", reason: error.reason };
    throw error;
  }
}

async function publishCoverageChecked(
  context: MediaAutomationContext,
  mediaIds: string[],
  operationId: string,
  proof: PublicationProof,
): ReturnType<PublicationActivities["publishMediaToPlex"]> {
  const execution = proof.compensation?.execution;
  await publicationAwait(execution, async () =>
    proof.compensation?.beforeNetwork(),
  );
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active) return { status: "blocked", reason: "runtime_observe" };
  if (runtime.epoch !== proof.epoch)
    return { status: "blocked", reason: "recovery_epoch_changed" };
  const { receipt } = proof;
  const coverages = await context.db.assetCoverage.findMany({
    where: { mediaId: { in: mediaIds }, current: true, edition: "default" },
    include: publicationCoverageInclude,
  });
  if (coverages.length === 0)
    return { status: "blocked", reason: "published_asset_missing" };
  assertDefaultPublicationCoverage(coverages);
  if (coverages.some((coverage) => !publicationLineageResolved(coverage)))
    return { status: "blocked", reason: "lineage_unresolved" };
  if (
    !(await recordsAuthorized(context.db, {
      epoch: runtime.epoch,
      mediaIds,
      assetIds: coverages.map((item) => item.assetId),
    }))
  )
    return { status: "blocked", reason: "record_ownership_unconfirmed" };
  if (
    !coverages.every(
      (coverage) =>
        proof.requiredGenerations === undefined ||
        publicationGenerationMatches(coverage, proof.requiredGenerations),
    )
  )
    return { status: "blocked", reason: "rollback_intent_changed" };
  if (!publicationMatchesReceipt(coverages, receipt))
    return { status: "blocked", reason: "restore_evidence_obsolete" };
  const kind = coverages[0]?.media.kind === "movie" ? "movie" : "episode";
  const sections = await publicationSections(context, kind, execution);
  const section = sections[0];
  if (section === undefined || sections.length !== 1)
    return { status: "blocked", reason: "plex_section_ambiguous" };
  const publicationScope = {
    mediaIds,
    assetIds: coverages.map((item) => item.assetId),
    compensation: proof.compensation,
  };
  await publicationAwait(execution, () =>
    beforePublicationRefresh(context, publicationScope),
  );
  await publicationAwait(execution, () =>
    context.plex.refresh(section.key, execution?.signal),
  );
  const items = await findPublished(context, {
    sectionId: section.key,
    kind,
    paths: new Set(coverages.map((coverage) => coverage.asset.path)),
    operationId,
    execution,
    scope:
      proof.releaseAttemptId === undefined
        ? "publication"
        : `rollback:${proof.releaseAttemptId}`,
  });
  if (
    items.size !==
    new Set(coverages.map((coverage) => coverage.asset.path)).size
  )
    return { status: "waiting", reason: "plex_scan_pending" };
  const matched = await verifiedPublicationItems(context, {
    coverages,
    items,
    sectionId: section.key,
    compensation: proof.compensation !== undefined,
    execution,
  });
  if (matched === null)
    return { status: "blocked", reason: "plex_identity_mismatch" };
  const { verified, compensationItems } = matched;
  if (
    new Set(compensationItems.map((item) => item.ratingKey)).size !==
    compensationItems.length
  )
    return { status: "blocked", reason: "plex_identity_ambiguous" };
  await publicationAwait(execution, () =>
    serializable(context.db, async (tx) => {
      await publicationAwait(execution, () =>
        lockPublicationScope(tx, publicationScope),
      );
      if (
        !(await lockRuntimeAuthority(tx, runtime.epoch)) ||
        !(await recordsAuthorized(tx, {
          epoch: runtime.epoch,
          mediaIds,
          assetIds: coverages.map((item) => item.assetId),
        }))
      )
        throw new Error("Publication ownership authority changed");
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      const currentRuntime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      if (
        currentRuntime.mode !== "active" ||
        !currentRuntime.ownershipConfirmed ||
        currentRuntime.recoveryEpoch !== runtime.epoch
      )
        throw new Error("Publication recovery epoch changed");
      for (const snapshot of coverages) {
        const current = await tx.assetCoverage.findUniqueOrThrow({
          where: {
            assetId_mediaId: {
              assetId: snapshot.assetId,
              mediaId: snapshot.mediaId,
            },
          },
          include: publicationCoverageInclude,
        });
        if (!samePublicationEvidence(current, snapshot))
          throw new Error("Publication evidence changed before commit");
      }
      for (const entry of verified) {
        const stillCurrent = await tx.assetCoverage.findUniqueOrThrow({
          where: {
            assetId_mediaId: { assetId: entry.assetId, mediaId: entry.mediaId },
          },
        });
        if (!stillCurrent.current || stillCurrent.edition !== "default")
          throw new Error("Publication asset changed during Plex verification");
        await tx.mediaItem.update({
          where: { id: entry.mediaId },
          data: {
            externalIds: {
              ...entry.externalIds,
              plexRatingKey: entry.ratingKey,
              plexSectionId: section.key,
            },
            availability: "available",
          },
        });
        await mirrorDefaultAvailability(tx, [entry.mediaId], "available");
      }
      if (proof.compensation === undefined)
        await recordVerifiedPublication(
          tx,
          verified.map((entry) => entry.assetId),
          runtime.epoch,
        );
      await proof.compensation?.commitVerified(tx, compensationItems);
      if (proof.notificationAttemptId !== undefined) {
        await queuePublicationNotifications(tx, proof.notificationAttemptId);
        const shared = await context.sharedAnnouncements?.();
        if (shared !== undefined)
          await queueSharedPublication(tx, proof.notificationAttemptId, shared);
      }
      if (proof.releaseAttemptId !== undefined)
        await tx.acquisitionReservation.deleteMany({
          where: { attemptId: proof.releaseAttemptId, edition: "default" },
        });
      execution?.signal.throwIfAborted();
      execution?.assertActive();
    }),
  );
  return { status: "available", reason: null };
}

async function finalize(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  assertDefaultEdition(attempt.edition);
  await serializable(context.db, async (tx) => {
    await lockDefaultScopes(
      tx,
      attempt.mediaIds.map((id) => defaultScope(id)),
      {
        createMissing: false,
      },
    );
    if (
      !(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)) ||
      !(await recordsAuthorized(tx, {
        epoch: attempt.recoveryEpoch,
        mediaIds: attempt.mediaIds,
      }))
    )
      throw new Error("Finalization ownership authority changed");
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      runtime.recoveryEpoch !== attempt.recoveryEpoch
    )
      throw new Error("Finalization recovery epoch changed");
    const media = await tx.mediaItem.findMany({
      where: { id: { in: attempt.mediaIds } },
    });
    if (media.some((item) => item.availability !== "available"))
      throw new Error("Cannot finalize media not verified in Plex");
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id, edition: "default" },
    });
    if (attempt.torrentId !== null)
      await queueOperation(tx, {
        key: `seed:${attempt.torrentId}`,
        kind: "maintain_torrent",
        targetId: attempt.torrentId,
        payload: { torrentId: attempt.torrentId },
      });
    const coverages = await tx.assetCoverage.findMany({
      where: {
        mediaId: { in: attempt.mediaIds },
        current: true,
        edition: "default",
      },
    });
    for (const assetId of new Set(coverages.map((item) => item.assetId)))
      await queueCurrentSubtitleTargets(tx, {
        assetId,
        epoch: attempt.recoveryEpoch,
      });
  });
}
