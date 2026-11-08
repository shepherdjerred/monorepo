import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { expect, test, vi } from "vitest";
import {
  createMovieRollbackFixture,
  movieRollbackEditions,
} from "@shepherdjerred/media/testing/movie-rollback-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

test.each(movieRollbackEditions)(
  "actual %s failed Plex restores exact A and captions with SDK-owned durable phases",
  async (edition) => {
    const f = await createMovieRollbackFixture(
      edition,
      rollbackInputs.videos(),
    );
    rollbackInputs.closeAfterTest(f.close);
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
    const rejected = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.rejectedMovie }),
    );
    const files = createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({ movie: f.fileMovie }),
    );
    const paidInvocations: number[] = [];
    const movie = {
      ...f.movie,
      verifyRolledBackMoviePlexV4: async (
        ...args: Parameters<typeof f.movie.verifyRolledBackMoviePlexV4>
      ) => {
        const budget = args[2];
        const consume = budget.consume.bind(budget);
        let paid = 0;
        const trace = vi
          .spyOn(budget, "consume")
          .mockImplementation((count) => {
            paid += count;
            consume(count);
          });
        try {
          return await f.movie.verifyRolledBackMoviePlexV4(...args);
        } finally {
          paidInvocations.push(paid);
          trace.mockRestore();
        }
      },
    };
    const network = createMovieNetworkWorkerActivitiesV4(() =>
      Promise.resolve({ movie }),
    );
    const original = await f.immutable();
    const before = await f.state();
    expect(before.predecessor).toMatchObject({
      state: "superseded",
      version: f.baseline.version + 1,
    });
    expect(before.successor).toMatchObject({ state: "published", version: 0 });
    const failed = await sdk("reject-b").run(
      rejected.publishMovieWithRollbackV4,
      f.input,
    );
    expect(failed.status).toBe("waiting");
    expect(failed.reason).not.toBeNull();
    expect(
      await f.db.applicationEvent.count({
        where: { kind: "movie_plex_rejected_v1", mediaId: f.scope.mediaId },
      }),
    ).toBe(1);
    expect(
      await sdk("prepare-rollback").run(files.prepareMovieRollbackV4, f.input),
    ).toEqual({ status: "prepared", reason: null });
    const prepared = await f.state();
    expect(prepared.predecessor).toEqual(before.predecessor);
    expect(prepared.successor).toEqual(before.successor);
    expect(prepared.bytes).toEqual(before.bytes);
    expect(prepared.pointer).toEqual(before.pointer);
    expect(
      await sdk("physical-rollback").run(
        files.rollbackMoviePublicationV4,
        f.input,
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    const physical = await f.state();
    expect(physical.predecessor).toMatchObject({
      state: "published",
      path: f.baseline.path,
      version: f.baseline.version + 2,
      checksum: f.baseline.checksum,
    });
    expect(physical.successor).toMatchObject({ state: "rejected", version: 1 });
    expect(physical.bytes).toEqual(before.bytes);
    expect(
      physical.predecessor.subtitles
        .filter(
          (row) => row.storageKind === "sidecar" && row.state === "installed",
        )
        .map((row) => row.language)
        .sort(),
    ).toEqual(["en", "zh-Hans"]);
    expect(physical.pointer).toMatchObject({
      evidenceId: null,
      associationHash: null,
      revision: before.pointer.revision + 1,
    });
    expect(
      await f.db.acquisitionReservation.count({
        where: { attemptId: f.input.attemptId },
      }),
    ).toBe(1);
    expect(
      await sdk("rebind-a").run(network.verifyRolledBackMoviePlexV4, f.input),
    ).toEqual({ status: "available", reason: null });
    // Exact same-transaction AA, command and historical-choice reuse removes
    // fourteen duplicate reads; current guards and the 100-record cap remain.
    expect(paidInvocations).toEqual([85]);
    const rebound = await f.state();
    expect(rebound.bytes).toEqual(before.bytes);
    expect(rebound.pointer.revision).toBe(before.pointer.revision + 2);
    expect(rebound.pointer.evidenceId).not.toBeNull();
    expect(rebound.predecessor.plexPublishedAt).toEqual(
      before.predecessor.plexPublishedAt,
    );
    expect(rebound.predecessor.rollbackExpiresAt).toEqual(
      before.predecessor.rollbackExpiresAt,
    );
    expect(
      await f.db.acquisitionReservation.count({
        where: { attemptId: f.input.attemptId },
      }),
    ).toBe(0);
    expect(await f.immutable()).toEqual(original);
    expect(rebound.torrents).toHaveLength(2);
    expect(f.wire.additions()).toBe(1);
    await f.db.mediaUser.update({
      where: { id: f.network.actor.id },
      data: { restricted: true },
    });
    expect(
      await sdk("ack-prepare").run(files.prepareMovieRollbackV4, f.input),
    ).toEqual({ status: "prepared", reason: null });
    expect(
      await sdk("ack-physical").run(files.rollbackMoviePublicationV4, f.input),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    expect(
      await sdk("ack-rebind").run(network.verifyRolledBackMoviePlexV4, f.input),
    ).toEqual({ status: "available", reason: null });
    expect(await f.state()).toEqual(rebound);
    expect(await f.immutable()).toEqual(original);
  },
  60_000,
);
