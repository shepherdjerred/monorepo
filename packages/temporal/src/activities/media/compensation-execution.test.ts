import { MockActivityEnvironment } from "@temporalio/testing";
import { expect, test, vi } from "vitest";
import {
  compensationCall,
  compensationExecution,
  compensationRuntimeCall,
} from "./compensation-execution.ts";

function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 300_000,
  });
}
test.each([undefined, NaN, Infinity, -Infinity, 0, -1])(
  "invalid compensation budget %s rejects before bootstrap",
  async (value) => {
    const env = environment();
    Object.defineProperty(env.context.info, "scheduleToCloseTimeoutMs", {
      value,
    });
    const load = vi.fn(() => Promise.resolve({}));
    await expect(
      env.run(() => compensationRuntimeCall(load, () => Promise.resolve())),
    ).rejects.toThrow("Compensation Activity failed");
    expect(load).not.toHaveBeenCalled();
  },
);
test("expiry during lazy initialization prevents the real activity boundary", async () => {
  const env = environment();
  const work = vi.fn(() => Promise.resolve("effect"));
  const clock = vi.spyOn(performance, "now");
  try {
    await expect(
      env.run(() =>
        compensationRuntimeCall(async () => {
          await Promise.resolve();
          clock.mockReturnValue(performance.now() + 120_001);
          return {};
        }, work),
      ),
    ).rejects.toThrow("Compensation Activity failed");
    expect(work).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
test("a waited lock that consumes the deadline cannot proceed or return success", async () => {
  const env = environment();
  const clock = vi.spyOn(performance, "now");
  const effect = vi.fn();
  try {
    await expect(
      env.run(() =>
        compensationCall(async (execution) => {
          await Promise.resolve();
          clock.mockReturnValue(performance.now() + 120_001);
          execution.assertActive();
          effect();
        }),
      ),
    ).rejects.toThrow("Compensation Activity failed");
    expect(effect).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
test("runtime factory obtains distinct current invocation cancellation signals", async () => {
  const first = environment();
  const signal = await first.run(() =>
    Promise.resolve(compensationExecution().signal),
  );
  first.cancel();
  await environment().run(async () => {
    const execution = compensationExecution();
    expect(execution.signal).not.toBe(signal);
    await execution.checkpoint("new-invocation");
  });
});
test("cancelled or private failures never publish a successful acknowledgement or raw detail", async () => {
  const env = environment();
  await expect(
    env.run(() =>
      compensationCall(async () => {
        env.cancel();
        await Promise.resolve();
        return "late";
      }),
    ),
  ).rejects.toThrow("cancelled");
  await expect(
    environment().run(() =>
      compensationCall(() =>
        Promise.reject(new Error("CAPABILITY_CANARY private path")),
      ),
    ),
  ).rejects.toMatchObject({
    message: "Compensation Activity failed; review protected operation status",
    cause: undefined,
    details: undefined,
  });
});
