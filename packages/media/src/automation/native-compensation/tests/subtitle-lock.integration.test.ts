import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { compensatedCaptionFixture } from "#infrastructure/native-compensation/caption.test-support.ts";
import { chooseCurrentTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { PrismaNativeCompensation } from "#infrastructure/native-compensation/service.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { compensationNativePlexFixture } from "#automation/native-compensation/fixtures/native-plex.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { FileLockError } from "#filesystem/advisory-lock.ts";
import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { restoreNativeFixtureAgain } from "#automation/native-compensation/native-grant-fixture.ts";
import { testCompensationExecution } from "#automation/native-compensation/test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof compensatedCaptionFixture>> | undefined;
beforeEach(async () => {
  fixture = await compensatedCaptionFixture(
    harness.database(),
    harness.context(),
  );
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.f.file.directory, { recursive: true, force: true });
});

test("compensation approval cannot bypass a held supplementary installation journal lock", async () => {
  if (fixture === undefined) throw new Error("Actual caption fixture missing");
  const { f, operation } = fixture;
  const db = harness.database();
  await chooseCurrentTestMovieEdition(db, {
    requestId: f.file.request.id,
    access: { serverMachineId: "server", movieSectionId: "1" },
  });
  const acquired = await f.file.acquisition("Interrupted caption successor");
  const files = createMediaFileActivities(f.file.context);
  expect(await files.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const checkpoint = f.file.context.checkpoint;
  const interrupted = new Error(
    "Actual caption publication transaction interrupted",
  );
  f.file.context.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase === "publication-before-commit") throw interrupted;
  };
  try {
    await expect(files.promoteMediaFiles(acquired.input)).rejects.toBe(
      interrupted,
    );
  } finally {
    f.file.context.checkpoint = checkpoint;
  }
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  const setup = await restoreNativeFixtureAgain(db, f);
  const hash = createHash("sha1").update(acquired.attempt.id).digest("hex");
  const torrent = {
    ...f.observation,
    hash,
    infohash_v1: hash,
    infohash_v2: "",
    save_path: `/downloads/media/${acquired.attempt.id}`,
    content_path: `/downloads/media/${acquired.attempt.id}/video.mkv`,
  };
  await db.torrent.update({
    where: { id: z.uuid().parse(acquired.attempt.torrentId) },
    data: {
      state: "seeding",
      infoHash: hash,
      qbittorrentId: hash,
      observation: { torrent },
    },
  });
  const source = f.observerContext.qbittorrent;
  const observer = {
    ...f.observerContext,
    qbittorrent: {
      login: () => source.login(),
      listAll: async () => [...(await source.listAll()), torrent],
    },
  };
  const service = new PrismaNativeCompensation(db, observer.describeWorkflow);
  const command = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    lifecycleKind: "publication_compensation",
    restoreOperationId: setup.restore.id,
    recoveryEpoch: setup.runtime.recoveryEpoch,
    runtimeVersion: setup.runtime.version,
    activation: "activate",
    transitionId: transition.id,
  });
  const input = {
    planId: z.uuid().parse(command.nativeRecoveryId),
    operationId: z.uuid().parse(command.operationId),
  };
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  const network = await compensationNativePlexFixture(
    observer,
    NativeCompensationScopeSchema.parse(plan.scope),
  );
  await createNativePlexObserver(network.context)(
    input,
    bindingTestExecution(),
  );
  const proof = new ContentProof();
  const journal = `journal/${operation.id}.json`;
  await proof.capture(path.join(f.file.roots.control, journal), () =>
    Promise.resolve(),
  );
  proof.seal();
  const verify = f.file.context.verifyPlexExclusion;
  if (verify === undefined)
    throw new Error("Actual fixture exclusion verifier missing");
  const holder = new FileOperations(f.file.roots, {
    contentProof: proof,
    authorize: () => Promise.reject(new Error("Lock holder cannot mutate")),
    verifyPlexExclusion: verify,
  });
  const activities = createNativeCompensationFileActivities(
    f.context,
    testCompensationExecution,
  );
  await holder.withContentPaths(
    [{ root: "control", path: journal }],
    async () => {
      await expect(
        activities.prepareNativeCompensationFiles(input),
      ).rejects.toEqual(new FileLockError("busy"));
      const pending = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      expect(pending.state).toBe("preparing");
      expect(
        await db.nativeRecoveryReceipt.count({
          where: { planId: input.planId },
        }),
      ).toBe(0);
    },
    [operation.id],
  );
  await activities.prepareNativeCompensationFiles(input);
  const reviewed = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  expect(reviewed.state).toBe("awaiting_review");
});
