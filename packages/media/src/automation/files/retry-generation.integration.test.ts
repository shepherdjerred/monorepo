import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createOutboxActivities } from "#automation/store.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

const h = automationTestHarness();
const Operation = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.int().nonnegative(),
});

async function retainedSeason() {
  const db = h.database();
  const f = await identityFixture(db, h.context(), false, {
    fileFactory: mappedPublicationFixture,
  });
  const siblings = await db.mediaItem.createManyAndReturn({
    data: Array.from({ length: 9 }, (_, index) => ({
      kind: "episode",
      title: `Episode ${String(index + 2)}`,
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: index + 2,
    })),
  });
  const media = [f.files.media, ...siblings];
  f.source.providerReleaseId = crypto.randomUUID();
  f.source.title = "Example.Show.2020.S01E01-E10.1080p.WEB-DL.H264.ENG";
  const profile = await loadProfile(db, f.files.media.id);
  if (profile === null) throw new Error("Original profile missing");
  const releases = await searchCandidates(f.network, f.files.media.id, profile);
  const releaseId = z.uuid().parse(releases[0]);
  const view = await f.service.getDefaultCommandContext(
    f.actor,
    f.files.media.id,
  );
  const selected = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    {
      schemaVersion: 2,
      scope: view.scope,
      expected: view.expected,
      command: { action: "select_release", releaseId },
    },
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(selected.result.operationId) },
  });
  const network = createAcquisitionActivities(f.network);
  const acquired = await network.reconcileMediaIntent(
    Operation.parse(operation.payload),
  );
  expect(acquired.status).toBe("acquire");
  const originalInput = {
    operationId: operation.id,
    attemptId: z.uuid().parse(acquired.attemptId),
  };
  expect(await network.submitMediaTorrent(originalInput)).toMatchObject({
    status: "submitted",
  });
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: originalInput.attemptId },
  });
  expect(birth.mediaIds.toSorted()).toEqual(
    media.map((item) => item.id).toSorted(),
  );
  const files = media.map((item, index) => ({
    index,
    name: `Example.Show.S01E${String(item.episodeNumber).padStart(2, "0")}.mkv`,
    size: 2,
    progress: 1,
  }));
  for (const file of files)
    await writeFile(path.join(f.files.roots.downloads, file.name), "tv");
  // Only the remote qBit completion/ffprobe boundary is synthetic; commands,
  // reservation birth, renewal generations and all file effects are real.
  await db.torrent.update({
    where: { id: z.uuid().parse(birth.torrentId) },
    data: {
      state: "ready",
      observation: {
        torrent: {
          progress: 1,
          save_path: storedFilePath(f.files.context, "tv", "downloads", ""),
        },
        files,
      },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: birth.id },
    data: { state: "ready" },
  });
  const originalProbe = f.files.context.inspect;
  if (originalProbe === undefined) throw new Error("Original probe missing");
  const probe = vi.fn(originalProbe);
  f.files.context.inspect = probe;
  const physical = createMediaFileActivities(f.files.context);
  expect(await physical.inspectAndStageMedia(originalInput)).toEqual({
    status: "staged",
  });
  const retained = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  const plan = FilePlanSchema.parse(retained.filePlan);
  expect(plan).toHaveLength(10);
  await createOutboxActivities(db, () =>
    Promise.reject(new Error("No workflow transport needed")),
  ).finishMediaOperation({
    operationId: operation.id,
    status: "reconciling",
    reason: "publication_authority_expired",
  });
  const beforeRetry = await f.service.getDefaultCommandContext(
    f.actor,
    f.files.media.id,
  );
  const retried = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    {
      schemaVersion: 2,
      scope: beforeRetry.scope,
      expected: beforeRetry.expected,
      command: { action: "retry" },
    },
  );
  const retryOperation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(retried.result.operationId) },
  });
  expect(
    await network.reconcileMediaIntent(Operation.parse(retryOperation.payload)),
  ).toMatchObject({
    status: "acquire",
    attemptId: birth.id,
    reason: "resume_existing_acquisition",
  });
  const current = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(current.generations).not.toEqual(retained.generations);
  expect(current.identityEvidence).toEqual(birth.identityEvidence);
  expect(current.torrentId).toBe(birth.torrentId);
  expect(current.filePlan).toEqual(retained.filePlan);
  const input = { attemptId: birth.id, operationId: retryOperation.id };
  expect(await physical.inspectAndStageMedia(input)).toEqual({
    status: "staged",
  });
  expect(probe).toHaveBeenCalledTimes(10);
  return { ...f, db, birth, retained, plan, current, input, physical };
}

test("normal v2 owner Retry publishes the same ten-file TV birth and immutable plan after real generation renewal", async () => {
  const f = await retainedSeason();
  try {
    expect(await f.physical.promoteMediaFiles(f.input)).toEqual({
      status: "published",
    });
    const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    expect(identityHash(final.filePlan)).toBe(
      identityHash(f.retained.filePlan),
    );
    expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
    expect(final.torrentId).toBe(f.birth.torrentId);
    expect(final.operationId).toBe(f.birth.operationId);
    expect(final.sponsorRequestId).toBe(f.birth.sponsorRequestId);
    expect(await f.db.acquisitionAttempt.count()).toBe(1);
    expect(await f.db.torrent.count()).toBe(1);
    expect(f.adds()).toBe(1);
    expect(
      await f.db.libraryAsset.count({
        where: { torrentId: final.torrentId, state: "published" },
      }),
    ).toBe(10);
    expect(await f.db.assetCoverage.count({ where: { current: true } })).toBe(
      10,
    );
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
}, 60_000);

test.each(["intent", "profile", "reservation", "request", "runtime"] as const)(
  "renewed TV publication still rejects changed %s authority before forward effects",
  async (change) => {
    const f = await retainedSeason();
    try {
      const target = {
        mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
      };
      switch (change) {
        case "intent": {
          const view = await f.service.getDefaultCommandContext(
            f.actor,
            f.files.media.id,
          );
          // A second real command advances the intent without adopting this attempt.
          await f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), {
            schemaVersion: 2,
            scope: view.scope,
            expected: view.expected,
            command: { action: "retry" },
          });
          break;
        }
        case "profile":
          await f.db.qualityProfile.update({
            where: { id: f.files.profile.id },
            data: { version: { increment: 1 } },
          });
          break;
        case "reservation":
          // This negative deliberately corrupts only a reservation, never the
          // positive fixture's real command/adoption generations.
          await f.db.acquisitionReservation.delete({ where: target });
          break;
        case "request":
          await f.db.mediaRequest.update({
            where: { id: f.files.request.id },
            data: { active: false },
          });
          break;
        case "runtime":
          await f.db.mediaRuntimeState.update({
            where: { id: "singleton" },
            data: { mode: "observe", ownershipConfirmed: false },
          });
          break;
      }
      expect(await f.physical.promoteMediaFiles(f.input)).toMatchObject({
        status: change === "runtime" ? "blocked" : "obsolete",
        reason:
          change === "intent"
            ? "intent_obsolete"
            : change === "profile"
              ? "profile_obsolete"
              : change === "reservation"
                ? "reservation_obsolete"
                : change === "request"
                  ? "request_obsolete"
                  : "runtime_protected",
      });
      expect(
        await f.db.libraryAsset.count({
          where: { torrentId: f.birth.torrentId },
        }),
      ).toBe(0);
      expect(
        await f.db.assetCoverage.count({
          where: { mediaId: { in: f.birth.mediaIds } },
        }),
      ).toBe(0);
      expect(
        await f.db.mediaPublicationTransition.count({
          where: { attemptId: f.birth.id },
        }),
      ).toBe(0);
      const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.birth.id },
      });
      expect(final.filePlan).toEqual(f.retained.filePlan);
      expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
      expect(final.torrentId).toBe(f.birth.torrentId);
      expect(f.adds()).toBe(1);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
  60_000,
);
