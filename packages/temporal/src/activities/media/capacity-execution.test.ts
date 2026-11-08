import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, test, vi } from "vitest";
import { CapacityCycleSchema } from "@shepherdjerred/media/capacity";
import { capacityExecution } from "./capacity-execution.ts";
import {
  capacityFileActivities,
  capacityNetworkActivities,
} from "./capacity.ts";

function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    scheduleToCloseTimeoutMs: 55_000,
    startToCloseTimeoutMs: 20_000,
    heartbeatTimeoutMs: 15_000,
  });
}
test("queue-expired invocation rejects before bootstrapping files or credentials", async () => {
  const expired = environment(Date.now() - 20_001);
  await expect(
    expired.run(
      capacityFileActivities.sampleMediaCapacity,
      CapacityCycleSchema.parse({
        recoveryEpoch: 0,
        cycles: [
          { role: "movies", revision: "1" },
          { role: "tv", revision: "1" },
        ],
      }),
    ),
  ).rejects.toThrow("Capacity observation failed");
});
test("monotonic deadline rejects late IO even if wall clock moves backwards; next invocation is independent", async () => {
  const at = Date.now();
  const env = environment(at);
  await env.run(() => {
    const execution = capacityExecution();
    const wall = vi.spyOn(Date, "now").mockReturnValue(at - 60_000);
    const monotonic = vi
      .spyOn(performance, "now")
      .mockReturnValue(performance.now() + 21_000);
    try {
      expect(() => execution.assertActive()).toThrow("deadline exceeded");
    } finally {
      wall.mockRestore();
      monotonic.mockRestore();
    }
    return Promise.resolve();
  });
  await environment(Date.now()).run(() => capacityExecution().checkpoint());
});
test("cancelled capacity roles do not initialize cached worker runtime", async () => {
  const env = environment(Date.now());
  env.cancel();
  await expect(
    env.run(capacityNetworkActivities.observeMediaCapacityMounts),
  ).rejects.toThrow("cancelled");
});
