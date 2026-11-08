import { expect, test } from "vitest";
import { createMovieRollbackTimezoneFixture } from "@shepherdjerred/media/testing/movie-rollback-timezone";
import { movieRollbackSdkEnvironment } from "./rollback-sdk.test-support.ts";
import { manualMovieRollbackWorkers } from "./manual-rollback-sdk.test-support.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

test.each(["America/Los_Angeles", "Asia/Tokyo"] as const)(
  "actual manual rollback retains exact UTC instants with %s PostgreSQL sessions",
  async (timezone) => {
    const f = await createMovieRollbackTimezoneFixture(
      timezone,
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
          `Actual timezone rollback phase: ${JSON.stringify({ timezone, name, invocation: workers.invocations.at(-1) })}`,
        );
      }
    }
    const before = await f.state();
    const immutable = await f.immutable();
    const dispatched = await f.dispatch();
    expect(dispatched.dispatched).toBe(1);
    expect(f.starts).toEqual([
      {
        workflowType: "rollbackMovieEditionV1Workflow",
        workflowId: `media-operation-${f.input.operationId}`,
        input: f.input,
      },
    ]);
    expect(
      await phase("admission-playback", () =>
        workers.observeRequestedMovieRollbackV1(f.input),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await phase("admission", () =>
        workers.prepareRequestedMovieRollbackV1(f.input),
      ),
    ).toEqual({ status: "prepared", reason: null });
    expect(
      await phase("physical-playback", () =>
        workers.observeRequestedMovieRollbackV1(f.input),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await phase("physical", () =>
        workers.rollbackRequestedMoviePublicationV1(f.input),
      ),
    ).toEqual({ status: "physically_rolled_back", reason: null });
    expect(
      await phase("rebind", () =>
        workers.verifyRequestedMovieRollbackV1(f.input),
      ),
    ).toEqual({ status: "available", reason: null });
    const after = await f.state();
    expect(after.cleanup).toEqual({
      ...before.cleanup,
      state: "cancelled",
      version: before.cleanup.version + 1,
    });
    expect(after.assets.find((asset) => asset.id === f.asset.id)?.state).toBe(
      "published",
    );
    expect(
      after.assets.find((asset) => asset.id === f.plan.entries[0].assetId)
        ?.state,
    ).toBe("rejected");
    expect(await f.immutable()).toEqual(immutable);
    expect(workers.invocations.every((entry) => entry.paid <= 100)).toBe(true);
  },
  60_000,
);
