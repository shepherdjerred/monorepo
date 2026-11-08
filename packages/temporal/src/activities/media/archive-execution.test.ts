import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, test, vi } from "vitest";
import { archiveCall, archiveExecution } from "./archive-execution.ts";
import {
  nativeArchiveFileActivities,
  nativeArchiveNetworkActivities,
} from "./native-archive.ts";
import { QUEUE_WORKER_DEFINITIONS } from "#worker-config";

function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 300_000,
  });
}
test("archive roles keep network credentials away from physical activities", () => {
  expect(
    QUEUE_WORKER_DEFINITIONS.filter(
      (item) =>
        item.kind === "activity" && "observeNativeArchive" in item.activities,
    ).map((item) => item.role),
  ).toEqual(["media-network"]);
  expect(
    QUEUE_WORKER_DEFINITIONS.filter(
      (item) =>
        item.kind === "activity" &&
        "cleanupNativeArchiveFiles" in item.activities,
    ).map((item) => item.role),
  ).toEqual(["media-files"]);
});
test.each([undefined, NaN, Infinity, -Infinity, 0, -1])(
  "invalid SDK overall budget %s rejects before lazy work",
  async (value) => {
    const env = environment();
    Object.defineProperty(env.context.info, "scheduleToCloseTimeoutMs", {
      value,
    });
    const work = vi.fn(() => Promise.resolve());
    await expect(env.run(() => archiveCall(work))).rejects.toThrow(
      "Archive Activity failed",
    );
    expect(work).not.toHaveBeenCalled();
  },
);
test("both role wrappers refuse expired work before runtime initialization", async () => {
  const input = {
    planId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  await expect(
    environment(Date.now() - 120_001).run(() =>
      nativeArchiveNetworkActivities.observeNativeArchive(input),
    ),
  ).rejects.toThrow("Archive Activity failed");
  await expect(
    environment(Date.now() - 120_001).run(() =>
      nativeArchiveFileActivities.prepareNativeArchiveFiles(input),
    ),
  ).rejects.toThrow("Archive Activity failed");
});
test("deadline after an awaited result and monotonic elapsed time cannot publish success", async () => {
  const env = environment();
  await env.run(async () => {
    const active = archiveExecution();
    const clock = vi
      .spyOn(performance, "now")
      .mockReturnValue(performance.now() + 120_001);
    try {
      expect(() => active.assertActive()).toThrow("deadline exceeded");
    } finally {
      clock.mockRestore();
    }
    await expect(
      archiveCall(async () => {
        env.cancel();
        await Promise.resolve();
        return "late";
      }),
    ).rejects.toThrow("cancelled");
  });
});
test.each([
  { attempt: 120_000, overall: 30_000, expected: 30_000 },
  { attempt: 20_000, overall: 300_000, expected: 20_000 },
])(
  "numeric expiry preserves the original SDK minimum $expected",
  async ({ attempt, overall, expected }) => {
    const at = Date.now();
    const env = new MockActivityEnvironment({
      scheduledTimestampMs: at,
      currentAttemptScheduledTimestampMs: at,
      startToCloseTimeoutMs: attempt,
      scheduleToCloseTimeoutMs: overall,
    });
    await env.run(async () => {
      const original = archiveExecution();
      const observed = original.observed;
      expect(original.expiresAtMs).toBe(at + expected);
      await original.checkpoint();
      expect(original.observed).toBe(observed);
      expect(original.expiresAtMs).toBe(at + expected);
      const monotonic = vi
        .spyOn(performance, "now")
        .mockReturnValue(performance.now() + expected + 1);
      try {
        expect(() => original.assertActive()).toThrow("deadline exceeded");
        // The numeric wall minimum stays fixed even when monotonic elapsed time rejects first.
        expect(original.expiresAtMs).toBe(at + expected);
      } finally {
        monotonic.mockRestore();
      }
    });
  },
);
test("each invocation gets a new signal and raw failure details never escape", async () => {
  const first = environment();
  const signal = await first.run(() =>
    Promise.resolve(archiveExecution().signal),
  );
  first.cancel();
  await environment().run(() => {
    const current = archiveExecution();
    expect(current.signal).not.toBe(signal);
    return current.checkpoint();
  });
  await expect(
    environment().run(() =>
      archiveCall(() =>
        Promise.reject(new Error("CAPABILITY_CANARY private path")),
      ),
    ),
  ).rejects.toMatchObject({
    message: "Archive Activity failed; review protected operation status",
    cause: undefined,
    details: undefined,
  });
});
