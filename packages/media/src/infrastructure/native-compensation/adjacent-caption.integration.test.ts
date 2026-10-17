import { beforeEach, afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import {
  QualityRulesSchema,
  PublicReleaseAttributesSchema,
} from "#shared/api.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import {
  compensatedCaptionFixture,
  installCompensationFixtureCaption,
} from "./caption.test-support.ts";
import { resolvePublicationTransitionAuthority } from "#infrastructure/publication-proof/authority.ts";
import { PrismaNativeArchive } from "#infrastructure/native-archive/service.ts";
import {
  grantNativePredecessor,
  restoreNativeFixtureAgain,
} from "#automation/native-compensation/native-grant-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
let fixture: Awaited<ReturnType<typeof compensatedCaptionFixture>> | undefined;
beforeEach(async () => {
  fixture = await compensatedCaptionFixture(
    harness.database(),
    harness.context(),
  );
  directories.push(fixture.f.file.directory);
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("a new caption after a native grant retains next-upgrade eligibility", async () => {
  if (fixture === undefined) throw new Error("Compensated predecessor missing");
  const { f } = fixture;
  const db = harness.database();
  const setup = await restoreNativeFixtureAgain(db, {
    ...f,
    prior: {
      ...f.prior,
      context: { ...f.prior.context, ...f.observerContext },
    },
  });
  const receipt = await grantNativePredecessor(db, setup);
  await installCompensationFixtureCaption(db, harness.context(), f, {
    assetId: f.asset.id,
    language: "zh-Hans",
  });
  const activities = createMediaFileActivities(f.file.context);
  const acquired = await f.file.acquisition(
    "Actual native-granted caption successor",
  );
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const completed = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const successor = FilePlanSchema.parse(completed.filePlan)[0];
  if (successor === undefined)
    throw new Error("Native caption successor plan missing");
  await db.$transaction(async (tx) => {
    await recordVerifiedPublication(
      tx,
      [successor.assetId],
      completed.recoveryEpoch,
    );
    await tx.acquisitionAttempt.update({
      where: { id: completed.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: completed.id },
    });
  });
  const infoHash = createHash("sha1").update(completed.id).digest("hex");
  await db.torrent.update({
    where: { id: z.uuid().parse(completed.torrentId) },
    data: {
      state: "seeding",
      infoHash,
      qbittorrentId: infoHash,
      observation: {
        torrent: {
          ...f.observation,
          hash: infoHash,
          infohash_v1: infoHash,
          infohash_v2: "",
          size: Number(successor.sizeBytes),
          save_path: `/downloads/media/${completed.id}`,
          content_path: `/downloads/media/${completed.id}/video.mkv`,
        },
      },
    },
  });
  const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: f.asset.id,
        successorAssetId: successor.assetId,
      },
    },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const interrupted = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.interrupted.attempt.id },
  });
  const prepared = await new PrismaNativeArchive(db).prepare(
    f.prior.actor,
    crypto.randomUUID(),
    {
      restoreOperationId: setup.restore.id,
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      activation: "extend",
      cleanupIds: [cleanup.id],
    },
  );
  expect(prepared.nativeRecoveryId).toEqual(expect.any(String));
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: interrupted.id },
    }),
  ).toEqual(interrupted);
  expect(
    await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
    }),
  ).toEqual(receipt);
});

test("adjacent ordinary publication followed by a new installed caption remains eligible for the next upgrade", async () => {
  if (fixture === undefined) throw new Error("Compensated predecessor missing");
  const { f } = fixture;
  const db = harness.database();
  const activities = createMediaFileActivities(f.file.context);
  const d = await f.file.acquisition("Actual adjacent version D");
  expect(await activities.inspectAndStageMedia(d.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(d.input)).toEqual({
    status: "published",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: d.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Actual D plan missing");
  await db.$transaction(async (tx) => {
    await recordVerifiedPublication(
      tx,
      [entry.assetId],
      d.attempt.recoveryEpoch,
    );
    await tx.acquisitionAttempt.update({
      where: { id: d.attempt.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: { attemptId: d.attempt.id },
    });
  });
  const before = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: d.attempt.id },
  });
  const installed = await installCompensationFixtureCaption(
    db,
    harness.context(),
    f,
    { assetId: entry.assetId },
  );
  const profile = await db.qualityProfile.findUniqueOrThrow({
    where: { id: f.file.profile.id },
  });
  await db.qualityProfile.update({
    where: { id: profile.id },
    data: {
      version: { increment: 1 },
      rules: z.record(z.string(), z.json()).parse({
        ...QualityRulesSchema.parse(profile.rules),
        tagScores: { next: 10 },
        cutoffScore: 10,
      }),
    },
  });
  const e = await f.file.acquisition("Actual adjacent version E after caption");
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: e.attempt.releaseId },
  });
  await db.releaseCandidate.update({
    where: { id: release.id },
    data: {
      attributes: z.record(z.string(), z.json()).parse({
        ...PublicReleaseAttributesSchema.parse(release.attributes),
        scoreTags: ["next"],
      }),
    },
  });
  expect(await activities.inspectAndStageMedia(e.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(e.input)).toEqual({
    status: "published",
  });
  const after = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: e.attempt.id },
  });
  const intent = PublicationIntentSchema.parse(after.intent);
  expect(
    intent.entries[0]?.subtitleEvidence?.journals.map(
      (journal) => journal.path,
    ),
  ).toContain(`journal/${installed.operation.id}.json`);
  const current = intent.entries[0]?.entry.assetId;
  if (current === undefined) throw new Error("Actual E missing");
  await expect(
    resolvePublicationTransitionAuthority(db, {
      transitionId: after.id,
      assetId: current,
    }),
  ).resolves.toMatchObject({ kind: "publication_transition_binding" });
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: before.id },
    }),
  ).toEqual(before);
});
