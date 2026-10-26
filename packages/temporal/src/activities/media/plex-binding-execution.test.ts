import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, expect, test, vi } from "vitest";
import {
  ReverifyPlexBindingInputSchema,
  type PlexBindingExecution,
} from "@shepherdjerred/media/plex-binding";
import { createPlexBindingNetworkActivities } from "./plex-binding.ts";
import { plexBindingExecution } from "./plex-binding-execution.ts";

afterEach(() => vi.restoreAllMocks());
const input = ReverifyPlexBindingInputSchema.parse({
  schemaVersion: 1,
  kind: "reverify_plex_binding",
  operationId: "00000000-0000-4000-8000-000000000001",
  recoveryEpoch: 1,
  assetIds: ["00000000-0000-4000-8000-000000000002"],
});
function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: 180_000,
    startToCloseTimeoutMs: 120_000,
    heartbeatTimeoutMs: 30_000,
  });
}

test("queue-expired SDK deadline and cancellation refuse even lazy runtime initialization", async () => {
  const load = vi.fn(() =>
    Promise.reject(new Error("Runtime must not initialize")),
  );
  const activities = createPlexBindingNetworkActivities(load);
  await expect(
    environment(Date.now() - 120_001).run(
      activities.reverifyPlexBinding,
      input,
    ),
  ).rejects.toThrow("Plex binding Activity failed");
  const cancelled = environment();
  cancelled.cancel();
  await expect(
    cancelled.run(activities.reverifyPlexBinding, input),
  ).rejects.toThrow("cancelled");
  expect(load).not.toHaveBeenCalled();
});

test("lazy initialization preserves the original proof deadline while exact receipt ACK remains within SDK budget", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const seen: PlexBindingExecution[] = [];
  const activities = createPlexBindingNetworkActivities(() => {
    clock.mockReturnValue(at + 61_000);
    return Promise.resolve({
      plexBinding: {
        reverify: (_input, execution) => {
          seen.push(execution);
          expect(execution.observed.wall).toBe(at);
          expect(execution.expiresAtMs).toBe(at + 60_000);
          execution.assertActive();
          return Promise.resolve({
            status: "verified" as const,
            bindingCount: 10_000,
          });
        },
      },
    });
  });
  await expect(
    environment(at).run(activities.reverifyPlexBinding, input),
  ).resolves.toEqual({ status: "verified", bindingCount: 10_000 });
  expect(seen).toHaveLength(1);
});

test("SDK expiry during lazy initialization prevents runtime consumer dispatch", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const reverify = vi.fn(() =>
    Promise.resolve({ status: "superseded" as const }),
  );
  const activities = createPlexBindingNetworkActivities(() => {
    clock.mockReturnValue(at + 120_000);
    return Promise.resolve({ plexBinding: { reverify } });
  });
  await expect(
    environment(at).run(activities.reverifyPlexBinding, input),
  ).rejects.toThrow("Plex binding Activity failed");
  expect(reverify).not.toHaveBeenCalled();
});

test("monotonic SDK expiry survives a wall-clock rollback and another invocation gets independent execution", async () => {
  const at = Date.now();
  let prior: AbortSignal | undefined;
  await environment(at).run(() => {
    const execution = plexBindingExecution();
    prior = execution.signal;
    vi.spyOn(Date, "now").mockReturnValue(at - 1);
    vi.spyOn(performance, "now").mockReturnValue(
      execution.observed.monotonic + 120_001,
    );
    expect(() => execution.assertActive()).toThrow("deadline exceeded");
    return Promise.resolve();
  });
  vi.restoreAllMocks();
  await environment().run(() => {
    const execution = plexBindingExecution();
    expect(execution.signal).not.toBe(prior);
    return execution.checkpoint();
  });
});

test("external error details are absent from the new Activity failure", async () => {
  const activities = createPlexBindingNetworkActivities(() =>
    Promise.reject(new Error("PRIVATE_PLEX_TOKEN_CANARY")),
  );
  await expect(
    environment().run(activities.reverifyPlexBinding, input),
  ).rejects.toThrow("Plex binding Activity failed");
  try {
    await environment().run(activities.reverifyPlexBinding, input);
    throw new Error("Expected failure");
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_PLEX_TOKEN_CANARY");
  }
});
