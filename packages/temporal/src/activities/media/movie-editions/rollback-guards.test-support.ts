import { expect } from "vitest";
import {
  createMovieRollbackFixture,
  type movieRollbackVideos,
} from "@shepherdjerred/media/testing/movie-rollback-workflow";
import {
  createMovieFileWorkerActivitiesV4,
  createMovieNetworkWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";

export async function rollbackGuardScenario(
  bytes: Awaited<ReturnType<typeof movieRollbackVideos>>,
) {
  const fixture = await createMovieRollbackFixture("extended_cut", bytes);
  const runId = crypto.randomUUID();
  const sdk = (activityId: string) =>
    movieRollbackSdkEnvironment({
      workflowExecution: {
        workflowId: `media-acquire-${fixture.input.attemptId}`,
        runId,
      },
      activityId,
      scheduledTimestampMs: Date.now(),
      currentAttemptScheduledTimestampMs: Date.now(),
      startToCloseTimeoutMs: 120_000,
      scheduleToCloseTimeoutMs: 180_000,
      heartbeatTimeoutMs: 30_000,
    });
  const files = createMovieFileWorkerActivitiesV4(() =>
    Promise.resolve({ movie: fixture.fileMovie }),
  );
  const network = createMovieNetworkWorkerActivitiesV4(() =>
    Promise.resolve({ movie: fixture.movie }),
  );
  const rejected = createMovieNetworkWorkerActivitiesV4(() =>
    Promise.resolve({ movie: fixture.rejectedMovie }),
  );
  return {
    ...fixture,
    sdk,
    files,
    network,
    async reject() {
      const result = await sdk("actual-negative").run(
        rejected.publishMovieWithRollbackV4,
        fixture.input,
      );
      expect(result.status).toBe("waiting");
      expect(
        await fixture.db.applicationEvent.count({
          where: {
            kind: "movie_plex_rejected_v1",
            mediaId: fixture.scope.mediaId,
          },
        }),
      ).toBe(1);
    },
    async admit() {
      expect(
        await sdk("actual-admission").run(
          files.prepareMovieRollbackV4,
          fixture.input,
        ),
      ).toEqual({ status: "prepared", reason: null });
    },
  };
}
