import { z } from "zod";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { vi } from "vitest";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { compensatedCaptionFixture } from "#infrastructure/native-compensation/caption.test-support.ts";
import { PrismaNativeArchive } from "./service.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { nativeReviewPlexFixture } from "#automation/native-recovery/fixtures/plex.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { testCompensationExecution } from "#automation/native-compensation/test-fixture.ts";
import { replaceCompensatedCaption } from "#infrastructure/native-compensation/caption-replacement.test-support.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

/** The old archive is created by A→C before the interrupted D and compensation. */
export async function archiveCaptionFixture(
  db: Database,
  network: MediaAutomationContext,
  replaceOriginal = false,
  publicationAgeDays = 0,
) {
  let originalAssetId: string | undefined;
  const caption = await compensatedCaptionFixture(db, network, {
    ...(replaceOriginal ? { omitLegacySubtitlePolicy: true } : {}),
    fileFactory: async () => {
      const file = await mappedPublicationFixture(db);
      await db.qualityProfile.update({
        where: { id: file.profile.id },
        data: {
          rules: {
            ...QualityRulesSchema.parse(file.profile.rules),
            qualities: ["WEB-720p", "WEB-1080p", "WEB-2160p"],
          },
        },
      });
      const inspect = file.context.inspect;
      if (inspect === undefined)
        throw new Error("Archive fixture inspection missing");
      return {
        ...file,
        published: async () => {
          file.context.inspect = async (name) => {
            const result = await inspect(name);
            return {
              ...result,
              streams: result.streams.map((stream) =>
                stream.codec_type === "video"
                  ? { ...stream, width: 1280, height: 720 }
                  : stream,
              ),
            };
          };
          const first = await file.published();
          originalAssetId = first.entry.assetId;
          await db.$transaction(async (tx) => {
            if (publicationAgeDays > 0)
              vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(
                Date.now() - publicationAgeDays * 86_400_000,
              );
            try {
              await recordVerifiedPublication(tx, [first.entry.assetId], 0);
            } finally {
              if (publicationAgeDays > 0) vi.useRealTimers();
            }
            await tx.acquisitionAttempt.update({
              where: { id: first.attempt.id },
              data: { state: "completed" },
            });
          });
          file.context.inspect = inspect;
          const acquired = await file.acquisition(
            "Actual archive predecessor C distinct from A",
          );
          const activities = createMediaFileActivities(file.context);
          const staged = await activities.inspectAndStageMedia(acquired.input);
          if (staged.status !== "staged")
            throw new Error(
              `Archive C staging protected: ${JSON.stringify(staged)}`,
            );
          const promoted = await activities.promoteMediaFiles(acquired.input);
          if (promoted.status !== "published")
            throw new Error(
              `Archive C publication protected: ${JSON.stringify(promoted)}`,
            );
          const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
            where: { id: acquired.attempt.id },
          });
          const entry = FilePlanSchema.parse(attempt.filePlan)[0];
          if (entry === undefined) throw new Error("Actual C plan missing");
          await db.acquisitionReservation.deleteMany({
            where: { attemptId: attempt.id },
          });
          const current = { ...acquired, entry };
          await db.$transaction(async (tx) => {
            if (publicationAgeDays > 0)
              vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(
                Date.now() - publicationAgeDays * 86_400_000,
              );
            try {
              await recordVerifiedPublication(tx, [current.entry.assetId], 0);
            } finally {
              if (publicationAgeDays > 0) vi.useRealTimers();
            }
          });
          return current;
        },
      };
    },
  });
  try {
    const { f } = caption;
    const original = await db.libraryAsset.findUniqueOrThrow({
      where: { id: z.uuid().parse(originalAssetId) },
    });
    const torrent = await db.torrent.findUniqueOrThrow({
      where: { id: z.uuid().parse(original.torrentId) },
    });
    const originalAttempt = await db.acquisitionAttempt.findFirstOrThrow({
      where: { torrentId: torrent.id },
    });
    const infoHash = createHash("sha1")
      .update(originalAttempt.id)
      .digest("hex");
    const observation = {
      ...f.observation,
      hash: infoHash,
      infohash_v1: infoHash,
      infohash_v2: "",
      size: Number(original.sizeBytes),
      save_path: `/downloads/media/${originalAttempt.id}`,
      content_path: `/downloads/media/${originalAttempt.id}/video.mkv`,
    };
    await db.torrent.update({
      where: { id: torrent.id },
      data: {
        state: "seeding",
        infoHash,
        qbittorrentId: infoHash,
        observation: { torrent: observation },
      },
    });
    const existing = await f.observerContext.qbittorrent.listAll();
    f.observerContext.qbittorrent.listAll = () =>
      Promise.resolve([...existing, observation]);
    const replacement = replaceOriginal
      ? await replaceCompensatedCaption(db, network, caption)
      : null;
    const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: z.uuid().parse(originalAssetId),
          successorAssetId: f.asset.id,
        },
      },
    });
    const service = new PrismaNativeArchive(db);
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const command = await service.prepare(f.prior.actor, crypto.randomUUID(), {
      restoreOperationId: f.restore.id,
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      activation: "extend",
      cleanupIds: [cleanup.id],
    });
    const input = {
      planId: z.uuid().parse(command.nativeRecoveryId),
      operationId: z.uuid().parse(command.operationId),
    };
    const execution = () => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      const current = testCompensationExecution();
      return {
        ...current,
        observed,
        checkpoint: () => current.checkpoint("archive-caption"),
      };
    };
    const preparedPlan = await db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    });
    const paired = await nativeReviewPlexFixture(
      f.observerContext,
      NativeStoredScopeSchema.parse(preparedPlan.scope),
    );
    const observer = paired.observe;
    const files = createNativeArchiveFileActivities(f.context, execution);
    await observer(input);
    await files.prepareNativeArchiveFiles(input);
    const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id: input.planId },
    });
    const approval = await service.apply(
      f.prior.actor,
      crypto.randomUUID(),
      plan.id,
      {
        expectedVersion: plan.version,
        planHash: z.string().parse(plan.planHash),
        recoveryEpoch: plan.recoveryEpoch,
        runtimeVersion: plan.runtimeVersion,
        acknowledgePhysicalOwnershipOnly: true,
        acknowledgeRecoveryHolds: true,
        acknowledgeSubtitlePolicies: true,
      },
    );
    return {
      ...caption,
      replacement,
      cleanup,
      plan,
      observer,
      observerContext: paired.context,
      files,
      applyInput: {
        planId: plan.id,
        operationId: z.uuid().parse(approval.operationId),
        planHash: z.string().parse(plan.planHash),
      },
    };
  } catch (error) {
    await rm(caption.f.file.directory, { recursive: true, force: true });
    throw error;
  }
}
