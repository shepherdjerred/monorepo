import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { expect, vi } from "vitest";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { PrismaNativeArchive } from "#infrastructure/native-archive/service.ts";
import { createNativeArchiveObserver } from "#migration/native-archive/producer.ts";
import { archiveContext, type NativeArchiveExecution } from "./execution.ts";
import { prepareNativeArchiveFiles } from "./files.ts";
import { finishArchivePreparation } from "./plan.ts";
import { applyPreparedNativeArchive } from "./apply.ts";
import type { NativeArchiveObserverContext } from "#migration/native-archive/evidence.ts";
import { configureArchiveTvPlex } from "./fixtures/shared-tv.ts";

type FileFixture = Awaited<ReturnType<typeof fileFixture>>;
type Published = Awaited<ReturnType<FileFixture["published"]>>;

async function upgrade(
  db: Database,
  file: FileFixture,
  index: number,
  ageDays: number,
): Promise<Published> {
  const acquired = await file.acquisition(
    `Actual native archive upgrade ${String(index)}`,
  );
  if (index === 2)
    await db.releaseCandidate.update({
      where: { id: acquired.attempt.releaseId },
      data: {
        attributes: {
          mediaIds: acquired.attempt.mediaIds,
          identityConfidence: "exact",
          quality: "Remux-2160p",
          codec: "H264",
          audioLanguages: ["en"],
          sizeBytes: Buffer.byteLength(acquired.content),
          scoreTags: [],
        },
      },
    });
  const activities = createMediaFileActivities(file.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Actual upgraded plan missing");
  await db.$transaction(async (tx) => {
    // Exercise the actual immutable deadline producer at a controlled historical time.
    // No existing cleanup row, publication timestamp or manifest is rewritten.
    if (ageDays > 0)
      vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(
        Date.now() - ageDays * 86_400_000,
      );
    try {
      await recordVerifiedPublication(tx, [entry.assetId], 0);
    } finally {
      if (ageDays > 0) vi.useRealTimers();
    }
    await tx.mediaItem.updateMany({
      where: { id: { in: acquired.attempt.mediaIds } },
      data: { availability: "available" },
    });
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id },
    });
  });
  return { ...acquired, entry };
}

export async function nativeArchiveFixture(
  db: Database,
  cipher: CredentialCipher,
  options: {
    chain?: 2 | 3;
    selected?: "first" | "all";
    publicationAgeDays?: number;
    withArchiveSubtitles?: boolean;
    fileFactory?: () => Promise<FileFixture>;
  } = {},
) {
  let ownedDirectory: string | undefined;
  try {
    const publications: Published[] = [];
    const setup = await nativeStorageFixture(db, cipher, "seeding", {
      ...(options.fileFactory === undefined
        ? {}
        : {
            fileFactory: async () => {
              const file = await options.fileFactory?.();
              if (file === undefined)
                throw new Error("Requested archive fixture factory missing");
              ownedDirectory = file.directory;
              return file;
            },
          }),
      settle: async (file, original) => {
        ownedDirectory = file.directory;
        publications.push(original);
        await db.acquisitionAttempt.update({
          where: { id: original.attempt.id },
          data: { state: "completed" },
        });
        const inspect = file.context.inspect;
        if (inspect === undefined)
          throw new Error("Real fixture probe missing");
        if (options.withArchiveSubtitles === true) {
          const asset = await db.libraryAsset.findUniqueOrThrow({
            where: { id: original.entry.assetId },
          });
          const sidecar = asset.path.replace(/\.[^.]+$/u, ".en.srt");
          const bytes =
            "1\n00:00:00,000 --> 00:00:01,000\nExact archive subtitle\n";
          await writeFile(sidecar, bytes);
          await db.subtitleAsset.create({
            data: {
              assetId: asset.id,
              language: "en",
              providerId: "fixture",
              state: "installed",
              storageKind: "sidecar",
              qualityStatus: "unverified",
              path: sidecar,
              checksum: createHash("sha256").update(bytes).digest("hex"),
              videoChecksum: asset.checksum,
              videoVersion: asset.version,
              ownershipEpoch: 0,
              provenance: { kind: "explicit_owned_fixture" },
              matchingEvidence: { ownershipOnly: true },
            },
          });
          await db.subtitleAsset.create({
            data: {
              assetId: asset.id,
              language: "en",
              providerId: "embedded",
              state: "installed",
              storageKind: "embedded",
              qualityStatus: "rejected",
              streamIndex: 2,
              codec: "subrip",
              videoChecksum: asset.checksum,
              videoVersion: asset.version,
              ownershipEpoch: 0,
              provenance: { kind: "explicit_embedded_fixture" },
              matchingEvidence: { rejectionReason: "unaccepted_quality" },
            },
          });
        }
        file.context.inspect = async (name) => {
          const measured = await inspect(name);
          return {
            ...measured,
            streams: [
              ...measured.streams.map((stream) =>
                stream.codec_type === "video"
                  ? { ...stream, width: 3840, height: 1600 }
                  : stream,
              ),
              ...(options.withArchiveSubtitles === true
                ? [
                    {
                      index: 2,
                      codec_type: "subtitle" as const,
                      codec_name: "subrip",
                      tags: { language: "eng" },
                    },
                  ]
                : []),
            ],
          };
        };
        publications.push(
          await upgrade(db, file, 1, options.publicationAgeDays ?? 0),
        );
        if (options.chain !== 2) {
          await db.qualityProfile.update({
            where: { id: file.profile.id },
            data: {
              version: { increment: 1 },
              rules: {
                ...QualityRulesSchema.parse(file.profile.rules),
                qualities: ["WEB-1080p", "WEB-2160p", "Remux-2160p"],
                cutoffQuality: "Remux-2160p",
              },
            },
          });
          publications.push(
            await upgrade(db, file, 2, options.publicationAgeDays ?? 0),
          );
        }
        for (const published of publications) {
          const asset = await db.libraryAsset.findUniqueOrThrow({
            where: { id: published.entry.assetId },
          });
          await db.libraryAsset.update({
            where: { id: asset.id },
            data: {
              path: asset.path
                .replace(
                  file.roots.control,
                  `/data/${published.entry.libraryKind}/.media-control`,
                )
                .replace(
                  file.roots.library,
                  `/data/${published.entry.libraryKind}`,
                ),
            },
          });
          for (const subtitle of await db.subtitleAsset.findMany({
            where: { assetId: asset.id, path: { not: null } },
          })) {
            if (subtitle.path === null)
              throw new Error("Fixture sidecar path missing");
            await db.subtitleAsset.update({
              where: { id: subtitle.id },
              data: {
                path: subtitle.path
                  .replace(
                    file.roots.control,
                    `/data/${published.entry.libraryKind}/.media-control`,
                  )
                  .replace(
                    file.roots.library,
                    `/data/${published.entry.libraryKind}`,
                  ),
              },
            });
          }
        }
        const current = publications.at(-1);
        if (current === undefined)
          throw new Error("Archive current publication missing");
        return current;
      },
    });
    const observations: z.infer<typeof StoredTorrentObservationSchema>[] = [];
    for (const published of publications) {
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: published.entry.assetId },
      });
      const infoHashV1 = createHash("sha1")
        .update(published.attempt.id)
        .digest("hex");
      const infoHashV2 = createHash("sha256")
        .update(published.attempt.id)
        .digest("hex");
      const observation = StoredTorrentObservationSchema.parse({
        ...setup.observation,
        infohash_v1: infoHashV1,
        infohash_v2: infoHashV2,
        hash: infoHashV2.slice(0, 40),
        save_path: `/downloads/media/${published.attempt.id}`,
        content_path: `/downloads/media/${published.attempt.id}/video.mkv`,
        size: Number(asset.sizeBytes),
      });
      observations.push(observation);
      await db.torrent.update({
        where: { id: z.string().parse(asset.torrentId) },
        data: {
          state: "seeding",
          infoHash: infoHashV1,
          qbittorrentId: observation.hash,
          observation: { torrent: observation },
        },
      });
    }
    const execution = testArchiveExecution;
    const observerContext: NativeArchiveObserverContext = {
      ...setup.prior.context,
      archiveExecution: execution,
      plex: {
        ...setup.prior.context.plex,
        activeSessions: () => Promise.resolve([]),
      },
      qbittorrent: {
        ...setup.prior.context.qbittorrent,
        listAll: () => Promise.resolve(observations),
      },
    };
    const context = archiveContext(setup.context, execution());
    if (setup.file.media.kind === "episode")
      await configureArchiveTvPlex(db, observerContext, {
        mediaIds: setup.published.entry.mediaIds,
        canonicalPath: setup.canonicalPath,
        sizeBytes: setup.asset.sizeBytes,
      });
    const cleanups = await db.upgradeCleanup.findMany({
      where: {
        assetId: { in: publications.map((item) => item.entry.assetId) },
      },
      orderBy: { createdAt: "asc" },
    });
    const first = cleanups.find(
      (row) => row.assetId === publications[0]?.entry.assetId,
    );
    if (first === undefined)
      throw new Error("Actual archive cleanup producer missing");
    const service = new PrismaNativeArchive(db);
    const queued = await service.prepare(
      setup.prior.actor,
      crypto.randomUUID(),
      {
        restoreOperationId: setup.restore.id,
        recoveryEpoch: setup.runtime.recoveryEpoch,
        runtimeVersion: setup.runtime.version,
        activation: "activate",
        cleanupIds:
          options.selected === "all"
            ? cleanups.map((row) => row.id)
            : [first.id],
      },
    );
    const planId = z.uuid().parse(queued.nativeRecoveryId);
    const prepareInput = {
      planId,
      operationId: z.uuid().parse(queued.operationId),
    };
    const observe = () => createNativeArchiveObserver(observerContext)(planId);
    async function prepare() {
      await observe();
      const proof = await prepareNativeArchiveFiles(context, prepareInput);
      await finishArchivePreparation(context, prepareInput, proof);
      return proof;
    }
    async function review() {
      const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      return await service.apply(
        setup.prior.actor,
        crypto.randomUUID(),
        planId,
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
    }
    async function apply() {
      const approval = await review();
      const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      const input = {
        planId,
        operationId: z.uuid().parse(approval.operationId),
        planHash: z.string().parse(plan.planHash),
      };
      await observe();
      return await applyPreparedNativeArchive(
        context,
        input,
        await prepareNativeArchiveFiles(context, input),
      );
    }
    return {
      ...setup,
      context,
      observerContext,
      execution,
      publications,
      cleanups,
      first,
      service,
      planId,
      prepareInput,
      observe,
      prepare,
      review,
      apply,
    };
  } catch (error) {
    if (ownedDirectory !== undefined)
      await rm(ownedDirectory, { recursive: true, force: true });
    throw error;
  }
}

function testArchiveExecution(): NativeArchiveExecution {
  const signal = new AbortController().signal;
  return {
    signal,
    assertActive: () => {
      signal.throwIfAborted();
    },
    checkpoint: () => Promise.resolve(),
  };
}
