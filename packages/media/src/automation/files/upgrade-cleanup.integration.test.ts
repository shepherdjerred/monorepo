import { afterAll, beforeAll, expect, test } from "vitest";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import nodePath from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";
import { QualityRulesSchema } from "#shared/api.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const db = cluster.database;
  const f = await fileFixture(db);
  directories.push(f.directory);
  const original = await f.published();
  const subtitlePath = nodePath.join(
    f.roots.library,
    `${original.entry.libraryPath}.en.srt`,
  );
  const subtitle = "1\n00:00:01,000 --> 00:00:03,000\nFixture caption\n";
  await writeFile(subtitlePath, subtitle);
  await db.subtitleAsset.create({
    data: {
      assetId: original.entry.assetId,
      language: "en",
      state: "installed",
      ownershipEpoch: 0,
      storageKind: "sidecar",
      qualityStatus: "unverified",
      checksum: createHash("sha256").update(subtitle).digest("hex"),
      videoChecksum: original.entry.checksum,
      videoVersion: 0,
      providerId: "fixture",
      path: subtitlePath,
      matchingEvidence: {},
      provenance: {
        checksum: createHash("sha256").update(subtitle).digest("hex"),
      },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: original.attempt.id },
    data: { state: "completed" },
  });
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Inspector missing");
  f.context.inspect = async (path) => {
    const probe = await inspect(path);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const acquired = await f.acquisition("Verified upgraded video contents");
  const activities = createMediaFileActivities(f.context);
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
  if (entry === undefined) throw new Error("Plan missing");
  expect(
    await db.upgradeCleanup.count({
      where: { assetId: original.entry.assetId },
    }),
  ).toBe(0);
  await db.$transaction(async (tx) => {
    await tx.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
    await recordVerifiedPublication(tx, [entry.assetId], 0);
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: attempt.id },
    });
  });
  const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: original.entry.assetId,
        successorAssetId: entry.assetId,
      },
    },
  });
  const old = await db.libraryAsset.findUniqueOrThrow({
    where: { id: original.entry.assetId },
    include: { subtitles: true },
  });
  return {
    ...f,
    original,
    acquired,
    entry,
    old,
    cleanup,
    activities,
    input: { cleanupId: cleanup.id, operationId: crypto.randomUUID() },
  };
}

test("cancelled cleanup terminates without touching restored rollback content", async () => {
  const f = await fixture();
  await cluster.database.upgradeCleanup.update({
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
  expect(await readFile(f.old.path, "utf8")).toBe(f.original.content);
});

test("cleanup starts at verified Plex publication, retains seven full days, and removes only superseded video and sidecars", async () => {
  const f = await fixture();
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "protected",
    reason: "rollback_window_incomplete",
  });
  f.advance(8 * 86_400_000);
  await cluster.database.$transaction(async (tx) => {
    await recordVerifiedPublication(tx, [f.entry.assetId], 0);
  });
  const repeated = await cluster.database.upgradeCleanup.findUniqueOrThrow({
    where: { id: f.cleanup.id },
  });
  expect(repeated.expiresAt).toEqual(f.cleanup.expiresAt);
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
  await expect(access(f.old.path)).rejects.toThrow();
  for (const subtitle of f.old.subtitles)
    if (subtitle.path !== null)
      await expect(access(subtitle.path)).rejects.toThrow();
  expect(
    await readFile(nodePath.join(f.roots.library, f.entry.libraryPath), "utf8"),
  ).toBe(f.acquired.content);
  expect(
    await readFile(
      nodePath.join(f.roots.downloads, f.original.entry.downloadPath),
      "utf8",
    ),
  ).toBe(f.original.content);
  const cleanup = await cluster.database.upgradeCleanup.findUniqueOrThrow({
    where: { id: f.cleanup.id },
  });
  expect(cleanup.state).toBe("purged");
});

test("purge effect followed by transaction failure resumes exact journals without deleting current playback", async () => {
  const f = await fixture();
  f.advance(8 * 86_400_000);
  f.context.checkpoint = (phase) =>
    phase === "purged"
      ? Promise.reject(new Error("interrupted purge"))
      : Promise.resolve();
  await expect(
    f.activities.cleanupSupersededMediaFile(f.input),
  ).rejects.toThrow("interrupted purge");
  const pending = await cluster.database.upgradeCleanup.findUniqueOrThrow({
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
  f.advance(8 * 86_400_000);
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
    const media = await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    });
    await new PrismaMediaCommands(cluster.database, { keepDays: 30 }).act(
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
  expect(await readFile(f.old.path, "utf8")).toBe(f.original.content);
});

test.each(["epoch", "recovery", "ownership", "coverage"] as const)(
  "cleanup protects %s changes",
  async (change) => {
    const f = await fixture();
    const db = cluster.database;
    f.advance(8 * 86_400_000);
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
    if (change === "recovery")
      await db.acquisitionAttempt.create({
        data: {
          releaseId: f.acquired.attempt.releaseId,
          sponsorRequestId: f.request.id,
          operationId: crypto.randomUUID(),
          mediaIds: [f.media.id],
          generations: { [f.media.id]: 0 },
          state: "failed",
          filePlan: [{ previousAssetId: f.old.id }],
        },
      });
    expect(
      await f.activities.cleanupSupersededMediaFile(f.input),
    ).toMatchObject({ status: "protected" });
    expect(await readFile(f.old.path, "utf8")).toBe(f.original.content);
  },
);

test("a later verified upgrade can protect playback while an earlier rollback copy expires", async () => {
  const f = await fixture();
  const db = cluster.database;
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
  await db.$transaction(async (tx) => {
    await tx.mediaItem.update({
      where: { id: f.media.id },
      data: { availability: "available" },
    });
    await tx.acquisitionAttempt.update({
      where: { id: third.attempt.id },
      data: { state: "completed" },
    });
    await recordVerifiedPublication(tx, [entry.assetId], 0);
  });
  f.advance(8 * 86_400_000);
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
    f.advance(8 * 86_400_000);
    if (condition === "missing_archive") await rm(f.old.path);
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
    const cleanup = await cluster.database.upgradeCleanup.findUniqueOrThrow({
      where: { id: f.cleanup.id },
    });
    expect(cleanup.state).toBe("pending");
  },
);
