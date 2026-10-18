import { expect } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import {
  QualityRulesSchema,
  PublicReleaseAttributesSchema,
} from "#shared/api.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { queueNativeArchiveCleanup } from "./continuation.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { createNativeArchiveCleanupObserver } from "#migration/native-archive/cleanup.ts";
import { chooseCurrentTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";

/** Real household declarations; the only injected authority is the fixture's scoped Plex identity mapping. */
export async function releaseTransitionHousehold(
  db: Database,
  f: Awaited<ReturnType<typeof nativeArchiveFixture>>,
) {
  for (const user of await db.mediaUser.findMany()) {
    const relevant = [f.prior.actor.id, f.file.user.id].includes(user.id);
    const mapping = {
      serverMachineId: "server",
      kind: "account",
      homeUserId: null,
      permittedSectionIds: relevant ? ["1"] : ["2"],
      permittedMediaKinds: relevant ? ["movie"] : ["series"],
      plexRestricted: false,
      verifiedAt: new Date(),
    };
    await db.plexIdentityMapping.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...mapping },
      update: { ...mapping, version: { increment: 1 } },
    });
  }
  const service = new PrismaRecovery(db, "server");
  const prepared = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    mediaIds: [f.file.media.id],
  });
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const detail = await service.detail(f.prior.actor, id);
  expect(detail.scope.blockers).toEqual([]);
  for (const actor of [f.prior.actor, f.file.user])
    await service.respond(actor, crypto.randomUUID(), id, {
      scopeHash: detail.scopeHash,
      declarations: [{ mediaId: f.file.media.id, intent: "request" }],
      acknowledgePending: true,
    });
  const reviewed = await service.detail(f.prior.actor, id);
  await service.release(f.prior.actor, crypto.randomUUID(), id, {
    expectedVersion: reviewed.version,
    scopeHash: reviewed.scopeHash,
    responseHash: z.string().parse(reviewed.responseHash),
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
}

/** A/B/C and its original approval are produced before D; no historical file path or receipt is rewritten. */
export async function archivePublicationTransitionFixture(
  db: Database,
  cipher: CredentialCipher,
  network: MediaAutomationContext,
  options: { stopOldCleanup?: "allocated" | "prepared" | "complete" } = {},
) {
  const f = await nativeArchiveFixture(db, cipher, {
    chain: 3,
    selected: "first",
    publicationAgeDays: 8,
    fileFactory: () => mappedPublicationFixture(db),
  });
  try {
    await f.prepare();
    const receiptId = await f.apply();
    await releaseTransitionHousehold(db, f);
    const old = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { receiptId, originalCleanupId: f.first.id },
    });
    const coordinatorOperationId = z.uuid().parse(
      await db.$transaction((tx) =>
        queueNativeArchiveCleanup(tx, {
          continuationId: old.id,
          expectedVersion: old.version,
        }),
      ),
    );
    if (options.stopOldCleanup !== undefined) {
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: coordinatorOperationId },
      });
      const cleanup = CleanupNativeArchiveInputSchema.parse(operation.payload);
      await createNativeArchiveCleanupObserver(f.observerContext)(cleanup);
      const checkpoint = f.context.files.checkpoint;
      const interrupted = new Error(
        `Actual old cleanup stopped at ${options.stopOldCleanup}`,
      );
      const stop =
        options.stopOldCleanup === "allocated"
          ? "native-archive-execution-committed"
          : options.stopOldCleanup === "prepared"
            ? "purged"
            : "native-archive-before-commit";
      f.context.files.checkpoint = async (phase) => {
        await checkpoint(phase);
        if (phase === stop) throw interrupted;
      };
      try {
        await expect(
          createNativeArchiveFileActivities(
            f.context,
            f.execution,
          ).cleanupNativeArchiveFiles(cleanup),
        ).rejects.toBe(interrupted);
      } finally {
        f.context.files.checkpoint = checkpoint;
      }
    }
    const oldContinuation =
      await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: old.id },
      });
    if (options.stopOldCleanup === undefined)
      expect(oldContinuation.executionEvidence).toBeNull();
    else expect(oldContinuation.executionEvidence).not.toBeNull();
    const oldReceipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    const oldCleanups = await db.upgradeCleanup.findMany({
      where: { id: { in: f.cleanups.map((row) => row.id) } },
      orderBy: { id: "asc" },
    });
    const profile = await db.qualityProfile.findUniqueOrThrow({
      where: { id: f.file.profile.id },
    });
    await db.qualityProfile.update({
      where: { id: profile.id },
      data: {
        version: { increment: 1 },
        rules: z.record(z.string(), z.json()).parse({
          ...QualityRulesSchema.parse(profile.rules),
          tagScores: { preferred: 10 },
          cutoffScore: 10,
        }),
      },
    });
    f.file.context.serverMachineId = "server";
    await chooseCurrentTestMovieEdition(db, {
      requestId: f.file.request.id,
      access: { serverMachineId: "server", movieSectionId: "1" },
    });
    const acquired = await f.file.acquisition(
      "Actual adjacent serving version D",
    );
    const release = await db.releaseCandidate.findUniqueOrThrow({
      where: { id: acquired.attempt.releaseId },
    });
    await db.releaseCandidate.update({
      where: { id: release.id },
      data: {
        attributes: z.record(z.string(), z.json()).parse({
          ...PublicReleaseAttributesSchema.parse(release.attributes),
          quality: "Remux-2160p",
          scoreTags: ["preferred"],
        }),
      },
    });
    const activities = createMediaFileActivities(f.file.context);
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
    if (entry === undefined)
      throw new Error("Actual D publication plan missing");
    const item = {
      ratingKey: "native",
      title: f.file.media.title,
      type: "movie",
      Guid: [{ id: `tmdb://${String(f.file.media.tmdbId)}` }],
      Media: [
        {
          Part: [
            {
              id: 1,
              file: f.canonicalPath,
              size: Buffer.byteLength(acquired.content),
            },
          ],
        },
      ],
    };
    f.observerContext.plex.metadata = () => Promise.resolve(item);
    f.observerContext.plex.libraryPage = ({ sectionId }) =>
      Promise.resolve({
        total: sectionId === "1" ? 1 : 0,
        items: sectionId === "1" ? [item] : [],
      });
    network.plex.metadata = f.observerContext.plex.metadata;
    network.plex.libraryPage = f.observerContext.plex.libraryPage;
    network.plex.sections = f.observerContext.plex.sections;
    network.plex.machineIdentifier = f.observerContext.plex.machineIdentifier;
    network.plex.activeSessions = f.observerContext.plex.activeSessions;
    network.plex.refresh = (sectionId) => {
      expect(sectionId).toBe("1");
      return Promise.resolve();
    };
    const publication = createPublicationActivities({
      ...network,
      serverMachineId: "server",
      permittedSections: f.observerContext.permittedSections,
      plex: network.plex,
    });
    expect(await publication.publishMediaToPlex(acquired.input)).toEqual({
      status: "available",
      reason: null,
    });
    await publication.finalizeMediaAcquisition(acquired.input);
    const sources = await f.observerContext.qbittorrent.listAll();
    const source = {
      ...f.observation,
      hash: createHash("sha1").update(attempt.id).digest("hex"),
      infohash_v1: createHash("sha1").update(attempt.id).digest("hex"),
      infohash_v2: "",
      save_path: `/downloads/media/${attempt.id}`,
      content_path: `/downloads/media/${attempt.id}/video.mkv`,
      size: Buffer.byteLength(acquired.content),
    };
    await db.torrent.update({
      where: { id: z.uuid().parse(attempt.torrentId) },
      data: {
        state: "seeding",
        infoHash: source.infohash_v1,
        qbittorrentId: source.hash,
        observation: { torrent: source },
      },
    });
    f.observerContext.qbittorrent.listAll = () =>
      Promise.resolve([...sources, source]);
    f.observerContext.describeWorkflow = (workflowId) => {
      expect(workflowId).toBe(`media-operation-${coordinatorOperationId}`);
      return Promise.resolve({
        status: "FAILED",
        runId: `closed-${coordinatorOperationId}`,
      });
    };
    return { ...f, acquired, entry, oldContinuation, oldReceipt, oldCleanups };
  } catch (error) {
    await rm(f.file.directory, { recursive: true, force: true });
    throw error;
  }
}
