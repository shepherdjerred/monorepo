import { afterEach, beforeAll, expect, test } from "vitest";
import {
  createMovieRollbackOriginFixture,
  movieRollbackOriginVideos,
} from "@shepherdjerred/media/testing/movie-rollback-origins";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { movieRollbackVideos } from "@shepherdjerred/media/testing/movie-rollback-workflow";

let videos: {
  library: Awaited<ReturnType<typeof movieRollbackOriginVideos>>;
  restored: Awaited<ReturnType<typeof movieRollbackVideos>>;
};
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  videos = {
    library: await movieRollbackOriginVideos(),
    restored: await movieRollbackVideos(),
  };
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

for (const kind of ["library", "restored"] as const) {
  test(`actual ${kind} A remains its literal origin after B rejection, native inverse and fresh SDK Plex rebind`, async () => {
    const f = await createMovieRollbackOriginFixture(kind, videos[kind]);
    closers.push(f.close);
    const runId = crypto.randomUUID();
    const sdk = (activityId: string) =>
      movieRollbackSdkEnvironment({
        workflowExecution: {
          workflowId: `media-acquire-${f.input.attemptId}`,
          runId,
        },
        activityId,
        scheduledTimestampMs: Date.now(),
        currentAttemptScheduledTimestampMs: Date.now(),
        startToCloseTimeoutMs: 120_000,
        scheduleToCloseTimeoutMs: 180_000,
        heartbeatTimeoutMs: 30_000,
      });
    const failures: { name: string; message: string; paid: number }[] = [];
    const rejected = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({
        movie: {
          ...f.rejectedMovie,
          publishMovieWithRollbackV4: async (...args) => {
            try {
              return await f.rejectedMovie.publishMovieWithRollbackV4(...args);
            } catch (error) {
              if (error instanceof Error)
                failures.push({
                  name: error.name,
                  message: error.message.replaceAll(
                    /(?:https?:\/\/|\/)[^\s"']+/gu,
                    "[redacted-path]",
                  ),
                  paid: args[2] === undefined ? 0 : 101 - args[2].take,
                });
              throw error;
            }
          },
        },
      }),
    );
    const files = createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.fileMovie }),
    );
    const network = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.movie }),
    );
    const original = await f.originalParents();
    const before = await f.state();
    const originalAsset = before.assets.find((asset) => asset.id === f.assetId);
    if (originalAsset === undefined)
      throw new Error("Actual origin fixture omitted A");
    const transition = await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.input.attemptId },
    });
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    if (kind === "library") {
      expect(attempt).toMatchObject({
        sponsorRequestId: null,
        movieEditionChoiceId: null,
        movieEditionAuthority: { schemaVersion: 2, kind: "library_management" },
      });
      expect(
        await f.db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
      ).toBe(0);
      expect(
        await f.db.movieEditionChoice.count({
          where: { rootMediaId: f.scope.mediaId },
        }),
      ).toBe(0);
    }
    const negative = await sdk("actual-negative-b")
      .run(rejected.publishMovieWithRollbackV4, f.input)
      .catch((error: unknown) => {
        throw new Error(
          `Actual ${kind} origin rejection failure: ${JSON.stringify(failures)}`,
          { cause: error },
        );
      });
    expect(negative.status).toBe("waiting");
    expect(
      await f.db.applicationEvent.count({
        where: { mediaId: f.scope.mediaId, kind: "movie_plex_rejected_v1" },
      }),
    ).toBe(1);
    expect(
      await sdk("prepare-original-parent").run(
        files.prepareMovieRollbackV4,
        f.input,
      ),
    ).toEqual({ status: "prepared", reason: null });
    expect(await f.state()).toEqual(before);
    expect(
      await sdk("inverse-original-parent").run(
        files.rollbackMoviePublicationV4,
        f.input,
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    const physical = await f.state();
    const a = physical.assets.find((asset) => asset.id === f.assetId);
    expect(a).toMatchObject({
      state: "published",
      version: f.predecessor.version + 2,
      path: f.predecessor.path,
      checksum: f.predecessor.checksum,
      plexPublishedAt: originalAsset.plexPublishedAt,
    });
    expect(
      physical.assets.find((asset) => asset.id === f.plan.entries[0].assetId),
    ).toMatchObject({ state: "rejected", version: 1 });
    expect(physical.files).toEqual(before.files);
    expect(
      a?.subtitles
        .filter(
          (caption) =>
            caption.storageKind === "sidecar" && caption.state === "installed",
        )
        .map((caption) => caption.language)
        .sort(),
    ).toEqual(["en", "zh-Hans"]);
    expect(physical.pointer).toMatchObject({
      evidenceId: null,
      associationHash: null,
      revision: before.pointer.revision + 1,
    });
    expect(
      await sdk("rebind-actual-original-part").run(
        network.verifyRolledBackMoviePlexV4,
        f.input,
      ),
    ).toEqual({ status: "available", reason: null });
    const after = await f.state();
    expect(after.files).toEqual(before.files);
    expect(after.pointer.revision).toBe(before.pointer.revision + 2);
    expect(after.pointer.evidenceId).not.toBeNull();
    expect(
      await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      }),
    ).toEqual(attempt);
    expect(
      await f.db.mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.input.attemptId },
      }),
    ).toEqual(transition);
    expect(await f.originalParents()).toEqual(original);
    expect(
      await f.db.acquisitionReservation.count({
        where: { attemptId: f.input.attemptId },
      }),
    ).toBe(0);
    expect(f.wire.additions()).toBe(1);
    expect(f.wire.control.deletes).toBe(0);
    expect(
      await sdk("ack-original-parent-prepare").run(
        files.prepareMovieRollbackV4,
        f.input,
      ),
    ).toEqual({ status: "prepared", reason: null });
    expect(
      await sdk("ack-original-parent-inverse").run(
        files.rollbackMoviePublicationV4,
        f.input,
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    expect(
      await sdk("ack-original-parent-rebind").run(
        network.verifyRolledBackMoviePlexV4,
        f.input,
      ),
    ).toEqual({ status: "available", reason: null });
    expect(await f.state()).toEqual(after);
    expect(await f.originalParents()).toEqual(original);
  }, 60_000);
}
