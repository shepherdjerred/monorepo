import { MockActivityEnvironment } from "@temporalio/testing";
import { CancelledFailure } from "@temporalio/common";
import { afterEach, expect, test, vi } from "vitest";
import { createPlexWatchActivities } from "./plex-watch.ts";

afterEach(() => vi.restoreAllMocks());

const operation = {
  operationId: "00000000-0000-4000-8000-000000000001",
  mediaId: "00000000-0000-4000-8000-000000000002",
  generation: 1,
};
const hint = {
  ...operation,
  schemaVersion: 1 as const,
  kind: "observe_plex_hint" as const,
  recoveryEpoch: 0,
  edition: "default" as const,
  serverMachineId: "synthetic",
  sectionId: "1",
  ratingKey: "2",
};
const sweep = { sweepId: "synthetic", kind: "watch" as const, cursor: null };

function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: 180_000,
    startToCloseTimeoutMs: 120_000,
    heartbeatTimeoutMs: 30_000,
  });
}
const fail = () => Promise.reject(new Error("private provider URL and query"));

test.each(["lazy", "consumer"] as const)(
  "%s errors preserve each public sanitized category without cause or details",
  async (phase) => {
    const activities = createPlexWatchActivities(async () => {
      if (phase === "lazy") return await fail();
      return {
        plexWatch: {
          evaluateMediaRetention: fail,
          sweepMediaWork: fail,
          observePlexEventHint: fail,
        },
      };
    });
    const generic = {
      type: "MediaActivityFailure",
      message: "Media Activity failed; inspect sanitized operation status",
      cause: undefined,
      details: undefined,
    };
    await expect(
      environment().run(activities.evaluateMediaRetention, operation),
    ).rejects.toMatchObject(generic);
    await expect(
      environment().run(activities.sweepMediaWork, sweep),
    ).rejects.toMatchObject(generic);
    await expect(
      environment().run(activities.observePlexEventHint, hint),
    ).rejects.toMatchObject({
      ...generic,
      type: "WatchObservationFailure",
      message: "Watch observation failed",
    });
  },
);

test("retention and repeated sweep work receive the original pre-lazy clock without renewing proof expiry", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const activities = createPlexWatchActivities(() => {
    clock.mockReturnValue(at + 61_000);
    return Promise.resolve({
      plexWatch: {
        evaluateMediaRetention: (_input, execution) => {
          expect(execution.observed.wall).toBe(at);
          expect(execution.expiresAtMs).toBe(at + 60_000);
          execution.assertActive();
          return Promise.resolve({
            status: "protected" as const,
            reason: "expired_proof",
            decisionId: null,
            wakeAt: null,
          });
        },
        sweepMediaWork: (_input, execution) => {
          for (let item = 0; item < 3; item++) {
            expect(execution.observed.wall).toBe(at);
            expect(execution.expiresAtMs).toBe(at + 60_000);
            execution.assertActive();
          }
          return Promise.resolve({ processed: 0, nextCursor: null });
        },
        observePlexEventHint: () =>
          Promise.resolve({ status: "superseded" as const, complete: false }),
      },
    });
  });
  await expect(
    environment(at).run(activities.evaluateMediaRetention, operation),
  ).resolves.toMatchObject({ reason: "expired_proof" });
  clock.mockReturnValue(at);
  await expect(
    environment(at).run(activities.sweepMediaWork, sweep),
  ).resolves.toEqual({ processed: 0, nextCursor: null });
});

test("generic activity cancellation remains cancellation rather than a watch failure", async () => {
  const env = environment();
  const dispatch = vi.fn(() =>
    Promise.resolve({ processed: 0, nextCursor: null }),
  );
  const activities = createPlexWatchActivities(() => {
    env.cancel();
    return Promise.resolve({
      plexWatch: {
        evaluateMediaRetention: () =>
          Promise.resolve({
            status: "complete" as const,
            reason: null,
            decisionId: null,
            wakeAt: null,
          }),
        sweepMediaWork: dispatch,
        observePlexEventHint: () =>
          Promise.resolve({ status: "superseded" as const, complete: false }),
      },
    });
  });
  await expect(
    env.run(activities.sweepMediaWork, sweep),
  ).rejects.toBeInstanceOf(CancelledFailure);
  expect(dispatch).not.toHaveBeenCalled();
});
