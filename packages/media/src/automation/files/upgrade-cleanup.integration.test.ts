import { afterAll, expect, test } from "vitest";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { upgradeCleanupFixture } from "./plex-binding/upgrade-cleanup.test-support.ts";
import { workerFilePath } from "./paths/locations.ts";
import { FilePlanSchema } from "./types.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

function fixture(elapsed = true) {
  return upgradeCleanupFixture(harness.database(), harness.context(), {
    elapsed,
    directoryCreated: (directory) => {
      directories.push(directory);
    },
  });
}

test("cancelled cleanup terminates without touching restored rollback content", async () => {
  const f = await fixture();
  await harness.database().upgradeCleanup.update({
    where: { id: f.cleanup.id },
    data: { state: "cancelled" },
  });
  f.context.checkpoint = async () => {
    throw new Error("Cancelled cleanup must not inspect files");
  };
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "obsolete",
    reason: "cleanup_cancelled",
  });
  expect(await readFile(workerFilePath(f.context, f.old.path), "utf8")).toBe(
    f.original.content,
  );
});

test("cleanup starts at verified Plex publication, retains seven full days, and removes only superseded video and sidecars", async () => {
  const fresh = await fixture(false);
  expect(
    await fresh.activities.cleanupSupersededMediaFile(fresh.input),
  ).toEqual({
    status: "protected",
    reason: "rollback_window_incomplete",
  });
  const f = await fixture();
  const before = await harness
    .database()
    .libraryAsset.findUniqueOrThrow({ where: { id: f.entry.assetId } });
  const publicationOperation = await harness
    .database()
    .operation.findUniqueOrThrow({
      where: { id: f.acquired.input.operationId },
    });
  const publicationCalls = [...f.transport.calls];
  expect(
    await createPublicationActivities(f.network).publishMediaToPlex(
      f.acquired.input,
    ),
  ).toEqual({ status: "available", reason: null });
  expect(
    await harness
      .database()
      .operation.findUniqueOrThrow({ where: { id: publicationOperation.id } }),
  ).toEqual(publicationOperation);
  expect(f.transport.calls).toEqual(publicationCalls);
  const repeated = await harness.database().upgradeCleanup.findUniqueOrThrow({
    where: { id: f.cleanup.id },
  });
  expect(repeated.expiresAt).toEqual(f.cleanup.expiresAt);
  const repeatedAsset = await harness
    .database()
    .libraryAsset.findUniqueOrThrow({ where: { id: f.entry.assetId } });
  expect(repeatedAsset.plexPublishedAt).toEqual(before.plexPublishedAt);
  expect(
    f.cleanup.expiresAt.getTime() -
      (before.plexPublishedAt?.getTime() ?? Number.NaN),
  ).toBe(7 * 86_400_000);
  f.context.checkpoint = (phase) =>
    phase === "hashing"
      ? Promise.reject(new Error("Final authority must not hash"))
      : Promise.resolve();
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  await expect(access(workerFilePath(f.context, f.old.path))).rejects.toThrow();
  for (const subtitle of f.old.subtitles)
    if (subtitle.path !== null)
      await expect(
        access(workerFilePath(f.context, subtitle.path)),
      ).rejects.toThrow();
  expect(
    await readFile(nodePath.join(f.roots.library, f.entry.libraryPath), "utf8"),
  ).toBe(f.acquired.content);
  expect(
    await readFile(
      nodePath.join(f.roots.downloads, f.original.entry.downloadPath),
      "utf8",
    ),
  ).toBe(f.original.content);
  const cleanup = await harness.database().upgradeCleanup.findUniqueOrThrow({
    where: { id: f.cleanup.id },
  });
  expect(cleanup.state).toBe("purged");
});

test("purge effect followed by transaction failure resumes exact journals without deleting current playback", async () => {
  const f = await fixture();
  f.context.checkpoint = (phase) =>
    phase === "purged"
      ? Promise.reject(new Error("interrupted purge"))
      : Promise.resolve();
  await expect(
    f.activities.cleanupSupersededMediaFile(f.input),
  ).rejects.toThrow("interrupted purge");
  const pending = await harness.database().upgradeCleanup.findUniqueOrThrow({
    where: { id: f.cleanup.id },
  });
  expect(pending.state).toBe("pending");
  f.context.checkpoint = () => Promise.resolve();
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  expect(
    await readFile(nodePath.join(f.roots.library, f.entry.libraryPath), "utf8"),
  ).toBe(f.acquired.content);
});

test("Keep can commit during rollback-expiry hashing and prevents the stale purge", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let paused = false;
  f.context.checkpoint = async (phase) => {
    if (phase === "content-proof-hashing" && !paused) {
      paused = true;
      entered.resolve(undefined);
      await resume.promise;
    }
  };
  const work = f.activities.cleanupSupersededMediaFile(f.input);
  await entered.promise;
  try {
    const media = await harness.database().mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    });
    await new PrismaMediaCommands(harness.database(), { keepDays: 30 }).act(
      { ...f.user, role: "member" },
      crypto.randomUUID(),
      f.media.id,
      { action: "keep", expectedVersion: media.version },
    );
  } finally {
    resume.resolve(undefined);
  }
  expect(await work).toEqual({
    status: "protected",
    reason: "cleanup_generation_changed",
  });
  expect(await readFile(workerFilePath(f.context, f.old.path), "utf8")).toBe(
    f.original.content,
  );
});

test.each(["epoch", "recovery", "ownership", "coverage"] as const)(
  "cleanup protects %s changes",
  async (change) => {
    const f = await fixture();
    const db = harness.database();
    if (change === "epoch")
      await db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 1 },
      });
    if (change === "ownership")
      await db.libraryAsset.update({
        where: { id: f.old.id },
        data: { owned: false },
      });
    if (change === "coverage")
      await db.assetCoverage.update({
        where: {
          assetId_mediaId: { assetId: f.entry.assetId, mediaId: f.media.id },
        },
        data: { current: false },
      });
    if (change === "recovery") {
      const movieAccess = await fileMovieAccess(f.context, [f.media.id]);
      if (movieAccess === undefined)
        throw new Error("Movie cleanup fixture access missing");
      const authority = await captureMovieAttemptChoice(db, {
        sponsorRequestId: f.request.id,
        scope: {
          rootMediaId: f.media.id,
          mediaId: f.media.id,
          edition: "default",
        },
        access: movieAccess,
      });
      await db.acquisitionAttempt.create({
        data: {
          ...authority,
          releaseId: f.acquired.attempt.releaseId,
          sponsorRequestId: f.request.id,
          operationId: crypto.randomUUID(),
          mediaIds: [f.media.id],
          generations: {
            [f.media.id]:
              authority.movieEditionAuthority.targetGenerationAtCapture,
          },
          recoveryEpoch: f.acquired.attempt.recoveryEpoch,
          state: "failed",
          filePlan: [{ previousAssetId: f.old.id }],
        },
      });
    }
    expect(
      await f.activities.cleanupSupersededMediaFile(f.input),
    ).toMatchObject({
      status: "protected",
      ...(change === "recovery"
        ? { reason: "cleanup_recovery_dependency" }
        : {}),
    });
    expect(await readFile(workerFilePath(f.context, f.old.path), "utf8")).toBe(
      f.original.content,
    );
  },
);

test("a later verified upgrade can protect playback while an earlier rollback copy expires", async () => {
  const f = await fixture();
  const db = harness.database();
  await db.qualityProfile.update({
    where: { id: f.profile.id },
    data: {
      version: { increment: 1 },
      rules: {
        ...QualityRulesSchema.parse(f.profile.rules),
        qualities: ["WEB-1080p", "WEB-2160p", "Remux-2160p"],
        cutoffQuality: "Remux-2160p",
      },
    },
  });
  const third = await f.acquisition("Newest verified remux video");
  await db.releaseCandidate.update({
    where: { id: third.attempt.releaseId },
    data: {
      attributes: {
        mediaIds: [f.media.id],
        identityConfidence: "exact",
        quality: "Remux-2160p",
        codec: "H264",
        audioLanguages: ["en"],
        sizeBytes: Buffer.byteLength(third.content),
        scoreTags: [],
      },
    },
  });
  expect(await f.activities.inspectAndStageMedia(third.input)).toEqual({
    status: "staged",
  });
  expect(await f.activities.promoteMediaFiles(third.input)).toEqual({
    status: "published",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: third.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Third plan missing");
  const transport = await retentionPlexContext(
    db,
    harness.context(),
    attempt.mediaIds,
  );
  const network = {
    ...transport.context,
    plexBindingExecution: bindingTestExecution,
  };
  const publisher = createPublicationActivities(network);
  expect(await publisher.publishMediaToPlex(third.input)).toEqual({
    status: "available",
    reason: null,
  });
  await publisher.finalizeMediaAcquisition(third.input);
  expect(
    await observeMediaUpgradeCleanup(network, f.input, bindingTestExecution()),
  ).toEqual({ status: "observed" });
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  expect(
    await readFile(nodePath.join(f.roots.library, entry.libraryPath), "utf8"),
  ).toBe(third.content);
});

test.each(["missing_archive", "corrupt_playback"] as const)(
  "cleanup protects %s evidence without claiming a successful deletion",
  async (condition) => {
    const f = await fixture();
    if (condition === "missing_archive")
      await rm(workerFilePath(f.context, f.old.path));
    else
      await writeFile(
        nodePath.join(f.roots.library, f.entry.libraryPath),
        "Unexpected current file",
      );
    expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
      status: "protected",
      reason:
        condition === "missing_archive"
          ? "cleanup_missing_unproven"
          : "cleanup_playback_content_changed",
    });
    const cleanup = await harness.database().upgradeCleanup.findUniqueOrThrow({
      where: { id: f.cleanup.id },
    });
    expect(cleanup.state).toBe("pending");
  },
);
