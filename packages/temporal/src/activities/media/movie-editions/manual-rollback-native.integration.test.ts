import { expect, test } from "vitest";
import { createManualMovieRollbackFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-workflow";
import { movieRollbackEditions } from "@shepherdjerred/media/testing/movie-rollback-workflow";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { manualMovieRollbackWorkers } from "./manual-rollback-sdk.test-support.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

test.each(movieRollbackEditions)(
  "actual %s manual owner rollback retains B-owned captions and original A/B history",
  async (edition) => {
    const f = await createManualMovieRollbackFixture(
      edition,
      rollbackInputs.videos(),
    );
    rollbackInputs.closeAfterTest(f.close);
    const workers = manualMovieRollbackWorkers(() => Promise.resolve(f.manual));
    const runId = crypto.randomUUID();
    const sdk = (activityId: string) =>
      movieRollbackSdkEnvironment({
        workflowExecution: {
          workflowId: `media-operation-${f.input.operationId}`,
          runId,
        },
        activityId,
        scheduledTimestampMs: Date.now(),
        currentAttemptScheduledTimestampMs: Date.now(),
        startToCloseTimeoutMs: 120_000,
        scheduleToCloseTimeoutMs: 180_000,
        heartbeatTimeoutMs: 30_000,
      });
    async function phase<T>(name: string, work: () => Promise<T>) {
      try {
        return await sdk(name).run(work);
      } catch {
        throw new Error(
          `Manual producer failure: ${JSON.stringify({ name, invocation: workers.invocations.at(-1) })}`,
        );
      }
    }
    async function outcome(
      name: string,
      work: () => Promise<{ status: string; reason: string | null }>,
      status: string,
    ) {
      const result = await phase(name, work);
      if (result.status !== status || result.reason !== null)
        throw new Error(
          `Actual manual outcome/read trace: ${JSON.stringify({ name, result, invocation: workers.invocations.at(-1) })}`,
        );
      expect(result).toEqual({ status, reason: null });
    }
    const before = await f.state();
    const immutable = await f.immutable();
    await f.db.mediaUser.update({
      where: { id: f.network.actor.id },
      data: { restricted: true },
    });
    f.setPlayback(true);
    expect(
      await phase("protected-active-playback", () =>
        workers.observeRequestedMovieRollbackV1(f.input),
      ),
    ).toEqual({ status: "blocked", reason: "active_playback" });
    expect(await f.state()).toEqual(before);
    const protectedReceipts = await f.receipts();
    expect(protectedReceipts.movieRollbackIntentV1).toBeUndefined();
    f.setPlayback(false);
    await outcome(
      "admission-playback",
      () => workers.observeRequestedMovieRollbackV1(f.input),
      "ready",
    );
    await outcome(
      "admit-manual",
      () => workers.prepareRequestedMovieRollbackV1(f.input),
      "prepared",
    );
    const admitted = await f.state();
    expect(admitted.assets).toEqual(before.assets);
    expect(admitted.files).toEqual(before.files);
    expect(admitted.pointer).toEqual(before.pointer);
    expect(admitted.cleanup).toEqual({
      ...before.cleanup,
      state: "cancelled",
      version: before.cleanup.version + 1,
    });
    const admissionReceipts = await f.receipts();
    const admission = admissionReceipts.movieRollbackIntentV1;
    expect(admission?.intent).toMatchObject({
      invocation: {
        mode: "manual_verified",
        command: f.input,
        source: f.sourceInput,
      },
      source: { state: "completed" },
      rejection: null,
      cleanup: {
        id: f.cleanup.id,
        version: f.cleanup.version,
        expiresAt: f.cleanup.expiresAt.toISOString(),
      },
      owner: { workflowId: `media-operation-${f.input.operationId}`, runId },
    });
    expect(admission?.intent.captionManifest?.captions).toHaveLength(2);
    await outcome(
      "physical-playback",
      () => workers.observeRequestedMovieRollbackV1(f.input),
      "ready",
    );
    await outcome(
      "inverse-manual",
      () => workers.rollbackRequestedMoviePublicationV1(f.input),
      "physically_rolled_back",
    );
    const inverse = await f.state();
    expect(fileOwnership(inverse.files)).toEqual(fileOwnership(before.files));
    expect(
      inverse.assets.find((asset) => asset.id === f.asset.id),
    ).toMatchObject({
      state: "published",
      path: f.baseline.path,
      version: f.baseline.version + 2,
    });
    const rejected = inverse.assets.find(
      (asset) => asset.id === f.plan.entries[0].assetId,
    );
    expect(rejected).toMatchObject({ state: "rejected", version: 1 });
    expect(
      rejected?.subtitles.filter(
        (caption) =>
          caption.state === "quarantined" && caption.storageKind === "sidecar",
      ),
    ).toHaveLength(2);
    expect(inverse.pointer).toMatchObject({
      evidenceId: null,
      revision: before.pointer.revision + 1,
    });
    await outcome(
      "rebind-original-a",
      () => workers.verifyRequestedMovieRollbackV1(f.input),
      "available",
    );
    const served = await f.state();
    expect(fileOwnership(served.files)).toEqual(fileOwnership(before.files));
    expect(served.cleanup).toEqual(admitted.cleanup);
    expect(served.pointer.revision).toBe(before.pointer.revision + 2);
    for (const asset of served.assets) {
      const previous = before.assets.find((row) => row.id === asset.id);
      expect(asset.plexPublishedAt).toEqual(previous?.plexPublishedAt);
      expect(asset.rollbackExpiresAt).toEqual(previous?.rollbackExpiresAt);
    }
    const servingReceipts = await f.receipts();
    const receipt = servingReceipts.movieRollbackPlexV1;
    expect(receipt?.receipt.expected.originalItem).toEqual(
      admission?.intent.originalItem,
    );
    expect(await f.immutable()).toEqual(immutable);
    const attempts = await f.db.acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    });
    await f.db.mediaUser.update({
      where: { id: f.network.actor.id },
      data: { restricted: false },
    });
    expect(await f.automaticBOnly()).toEqual({
      status: "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    });
    expect(
      await f.db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.scope.mediaId } },
      }),
    ).toBe(attempts);
    expect(f.wire.additions()).toBe(1);
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: { restricted: true },
    });
    await outcome(
      "historical-prepare-ack",
      () => workers.prepareRequestedMovieRollbackV1(f.input),
      "prepared",
    );
    await outcome(
      "historical-inverse-ack",
      () => workers.rollbackRequestedMoviePublicationV1(f.input),
      "physically_rolled_back",
    );
    await outcome(
      "historical-serving-ack",
      () => workers.verifyRequestedMovieRollbackV1(f.input),
      "available",
    );
    expect(await f.immutable()).toEqual(immutable);
    expect(
      workers.invocations.every(
        (invocation) => invocation.paid > 0 && invocation.paid <= 100,
      ),
    ).toBe(true);
  },
  60_000,
);

function fileOwnership(
  files: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createManualMovieRollbackFixture>>["state"]
    >
  >["files"],
) {
  return files
    .map(({ path: _path, ...ownership }) => ownership)
    .sort((left, right) =>
      JSON.stringify([left.assetId, left.subtitleId]).localeCompare(
        JSON.stringify([right.assetId, right.subtitleId]),
      ),
    );
}
