import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, test, vi } from "vitest";
import { ObservePlexHintInputSchema } from "@shepherdjerred/media/plex-events";
import { watchCall, watchExecution } from "./watch-execution.ts";
import { plexEventNetworkActivities } from "./plex-events.ts";
import { QUEUE_WORKER_DEFINITIONS } from "#worker-config";

function environment(at = Date.now(), overall = 180_000) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: overall,
    startToCloseTimeoutMs: 120_000,
    heartbeatTimeoutMs: 30_000,
  });
}
const input = ObservePlexHintInputSchema.parse({
  schemaVersion: 1,
  kind: "observe_plex_hint",
  operationId: "00000000-0000-4000-8000-000000000001",
  mediaId: "00000000-0000-4000-8000-000000000002",
  recoveryEpoch: 0,
  edition: "default",
  generation: 1,
  serverMachineId: "fixture-server",
  sectionId: "1",
  ratingKey: "42",
});

test("hint is registered only on the network worker", () => {
  expect(
    QUEUE_WORKER_DEFINITIONS.filter(
      (item) =>
        item.kind === "activity" && "observePlexEventHint" in item.activities,
    ).map((item) => item.role),
  ).toEqual(["media-network"]);
});
test("expired and cancelled hints reject before lazy runtime credentials initialize", async () => {
  await expect(
    environment(Date.now() - 120_001).run(
      (value) => plexEventNetworkActivities.observePlexEventHint(value),
      input,
    ),
  ).rejects.toThrow("Watch observation failed");
  const cancelled = environment();
  cancelled.cancel();
  await expect(
    cancelled.run(
      (value) => plexEventNetworkActivities.observePlexEventHint(value),
      input,
    ),
  ).rejects.toThrow("Watch observation cancelled");
});
test("missing overall SDK timeout fails before work", async () => {
  const absent = environment();
  Object.defineProperty(absent.context.info, "scheduleToCloseTimeoutMs", {
    value: undefined,
  });
  const work = vi.fn(() => Promise.resolve());
  await expect(absent.run(() => watchCall(work))).rejects.toThrow(
    "Watch observation failed",
  );
  expect(work).not.toHaveBeenCalled();
});
test.each([NaN, Infinity, -Infinity, 0, -1])(
  "invalid present overall timeout %s fails before work",
  async (overall) => {
    const work = vi.fn(() => Promise.resolve());
    await expect(
      environment(Date.now(), overall).run(() => watchCall(work)),
    ).rejects.toThrow("Watch observation failed");
    expect(work).not.toHaveBeenCalled();
  },
);
test("a missing attempt budget fails before work", async () => {
  const absent = environment();
  Object.defineProperty(absent.context.info, "startToCloseTimeoutMs", {
    value: undefined,
  });
  const work = vi.fn(() => Promise.resolve());
  await expect(absent.run(() => watchCall(work))).rejects.toThrow(
    "Watch observation failed",
  );
  expect(work).not.toHaveBeenCalled();
});
test("overall queue budget and monotonic elapsed time cannot be renewed by wall clock changes", async () => {
  await expect(
    environment(Date.now() - 60_001, 60_000).run(() =>
      watchCall(() => Promise.resolve()),
    ),
  ).rejects.toThrow("Watch observation failed");
  await environment().run(() => {
    const execution = watchExecution();
    const wall = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 300_000);
    const monotonic = vi
      .spyOn(performance, "now")
      .mockReturnValue(performance.now() + 120_001);
    try {
      expect(() => execution.assertActive()).toThrow("deadline exceeded");
    } finally {
      wall.mockRestore();
      monotonic.mockRestore();
    }
    return Promise.resolve();
  });
  await environment().run(() => watchExecution().checkpoint());
});
test("each invocation obtains its own signal and exception details are discarded", async () => {
  const first = environment();
  const signal = await first.run(() =>
    Promise.resolve(watchExecution().signal),
  );
  first.cancel();
  await environment().run(() => {
    const next = watchExecution();
    expect(next.signal).not.toBe(signal);
    expect(next.signal.aborted).toBe(false);
    return next.checkpoint();
  });
  await expect(
    environment().run(() =>
      watchCall(() => {
        throw new Error(
          "https://private.invalid/events/plex?key=CAPABILITY_CANARY",
        );
      }),
    ),
  ).rejects.toMatchObject({
    message: "Watch observation failed",
    cause: undefined,
    details: undefined,
  });
});
