import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "./acquisition.ts";

afterEach(() => vi.restoreAllMocks());
const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  mediaId: "00000000-0000-4000-8000-000000000003",
  generation: 1,
};
const networkMethods = [
  "reconcileMediaIntent",
  "submitMediaTorrent",
  "observeMediaAcquisition",
] as const;
const fileMethods = ["inspectAndStageMedia", "promoteMediaFiles"] as const;
type FileExecution = Parameters<
  Awaited<
    ReturnType<typeof createMediaFileRuntime>
  >["acquisition"]["promoteMediaFiles"]
>[1];

function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
    heartbeatTimeoutMs: 30_000,
  });
}
function networkRuntime(check: (execution: PlexBindingExecution) => void) {
  return {
    acquisition: {
      reconcileMediaIntent: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({
          status: "waiting" as const,
          attemptId: null,
          reason: null,
        });
      },
      submitMediaTorrent: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "submitted" as const, reason: null });
      },
      observeMediaAcquisition: (
        _input: unknown,
        execution: PlexBindingExecution,
      ) => {
        check(execution);
        return Promise.resolve({ status: "ready" as const, reason: null });
      },
    },
  };
}
function fileRuntime(check: (execution: FileExecution) => void) {
  return {
    acquisition: {
      inspectAndStageMedia: (_input: unknown, execution: FileExecution) => {
        check(execution);
        return Promise.resolve({ status: "staged" as const });
      },
      promoteMediaFiles: (_input: unknown, execution: FileExecution) => {
        check(execution);
        return Promise.resolve({ status: "published" as const });
      },
    },
  };
}

test.each(networkMethods)(
  "%s captures original SDK observation before a cold runtime and rejects expiry during load",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const effect = vi.fn((execution: PlexBindingExecution) => {
      expect(execution.observed.wall).toBe(at);
      execution.assertActive();
    });
    const activity = createAcquisitionNetworkWorkerActivities(() => {
      clock.mockReturnValue(at + 1);
      return Promise.resolve(networkRuntime(effect));
    })[method];
    await environment(at).run(activity, input);
    expect(effect).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(at);
    effect.mockClear();
    const expired = createAcquisitionNetworkWorkerActivities(() => {
      clock.mockReturnValue(at + 120_001);
      return Promise.resolve(networkRuntime(effect));
    })[method];
    await expect(environment(at).run(expired, input)).rejects.toMatchObject({
      type: "PlexBindingActivityFailure",
    });
    expect(effect).not.toHaveBeenCalled();
  },
);

test.each(fileMethods)(
  "%s retains the original Files SDK observation and cannot renew it after lazy loading",
  async (method) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const effect = vi.fn((execution: FileExecution) => {
      expect(execution.observed.wall).toBe(at);
      execution.assertActive();
    });
    const activity = createAcquisitionFileWorkerActivities(() => {
      clock.mockReturnValue(at + 1);
      return Promise.resolve(fileRuntime(effect));
    })[method];
    await environment(at).run(activity, input);
    expect(effect).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(at);
    effect.mockClear();
    const expired = createAcquisitionFileWorkerActivities(() => {
      clock.mockReturnValue(at + 120_001);
      return Promise.resolve(fileRuntime(effect));
    })[method];
    await expect(environment(at).run(expired, input)).rejects.toMatchObject({
      type: "CompensationActivityFailure",
    });
    expect(effect).not.toHaveBeenCalled();
  },
);

test("cancellation cannot invoke acquisition or file facets during a cold runtime load", async () => {
  const at = Date.now();
  const effect = vi.fn();
  for (const method of networkMethods) {
    const env = environment(at);
    const activity = createAcquisitionNetworkWorkerActivities(() => {
      env.cancel();
      return Promise.resolve(networkRuntime(effect));
    })[method];
    await expect(env.run(activity, input)).rejects.toThrow("cancelled");
  }
  for (const method of fileMethods) {
    const env = environment(at);
    const activity = createAcquisitionFileWorkerActivities(() => {
      env.cancel();
      return Promise.resolve(fileRuntime(effect));
    })[method];
    await expect(env.run(activity, input)).rejects.toThrow("cancelled");
  }
  expect(effect).not.toHaveBeenCalled();
});
