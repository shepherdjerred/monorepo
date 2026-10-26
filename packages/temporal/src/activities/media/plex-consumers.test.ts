import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { createPlexBoundConsumerActivities } from "./plex-consumers.ts";

afterEach(() => vi.restoreAllMocks());
const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  mediaId: "00000000-0000-4000-8000-000000000003",
  generation: 1,
};
const notification = {
  operationId: input.operationId,
  notificationId: "00000000-0000-4000-8000-000000000004",
};
function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: 180_000,
    startToCloseTimeoutMs: 120_000,
    heartbeatTimeoutMs: 30_000,
  });
}

test("finalization and notification retain the original proof anchor while immutable notification ACK remains SDK-authorized", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const assertOriginal = (execution: PlexBindingExecution) => {
    expect(execution.observed.wall).toBe(at);
    expect(execution.expiresAtMs).toBe(at + 60_000);
    expect(Date.now()).toBe(at + 61_000);
    execution.assertActive();
  };
  const activities = createPlexBoundConsumerActivities(() => {
    clock.mockReturnValue(at + 61_000);
    return Promise.resolve({
      plexBinding: {
        finalizeMediaAcquisition: (_input, execution) => {
          assertOriginal(execution);
          return Promise.resolve();
        },
        deliverMediaNotification: (_input, execution) => {
          assertOriginal(execution);
          return Promise.resolve({ status: "accepted" as const, reason: null });
        },
      },
    });
  });
  await environment(at).run(activities.finalizeMediaAcquisition, input);
  clock.mockReturnValue(at);
  await expect(
    environment(at).run(activities.deliverMediaNotification, notification),
  ).resolves.toEqual({ status: "accepted", reason: null });
});

test("both generic consumers sanitize lazy failures without serializing private causes or details", async () => {
  const at = Date.now();
  const activities = createPlexBoundConsumerActivities(() =>
    Promise.reject(new Error("private query URL")),
  );
  const failure = {
    type: "MediaActivityFailure",
    message: "Media Activity failed; inspect sanitized operation status",
    cause: undefined,
    details: undefined,
  };
  await expect(
    environment(at).run(activities.finalizeMediaAcquisition, input),
  ).rejects.toMatchObject(failure);
  await expect(
    environment(at).run(activities.deliverMediaNotification, notification),
  ).rejects.toMatchObject(failure);
});
