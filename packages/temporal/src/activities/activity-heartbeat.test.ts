import { afterEach, describe, expect, test, vi } from "vitest";
import { withActivityHeartbeat } from "./activity-heartbeat.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("long Activity heartbeats", () => {
  test("heartbeats every 30 seconds during slow I/O and clears the timer", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn();
    let complete: (() => void) | undefined;
    const operation = withActivityHeartbeat(
      { heartbeat, cancellationSignal: new AbortController().signal },
      async ({ onProgress }) => {
        onProgress({ stage: "gc-sweep", completed: 17, total: 100 });
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return 17;
      },
      { stage: "start", completed: 0, total: 100 },
    );
    await vi.advanceTimersByTimeAsync(65_000);
    expect(heartbeat).toHaveBeenLastCalledWith({
      stage: "gc-sweep",
      completed: 17,
      total: 100,
    });
    expect(heartbeat).toHaveBeenCalledTimes(4);
    complete?.();
    await expect(operation).resolves.toBe(17);
    const calls = heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(heartbeat).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("passes Activity cancellation to in-flight operations and clears the timer", async () => {
    vi.useFakeTimers();
    const cancellation = new AbortController();
    const operation = withActivityHeartbeat(
      { heartbeat: vi.fn(), cancellationSignal: cancellation.signal },
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(new Error("Activity cancelled", { cause: signal.reason })),
            {
              once: true,
            },
          );
        }),
      { stage: "start", completed: 0, total: 100 },
    );
    const assertion = expect(operation).rejects.toThrow("Activity cancelled");
    cancellation.abort(new Error("Activity cancelled"));
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("aborts writes when sending a heartbeat fails", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockImplementationOnce(() => {
      /* Initial heartbeat succeeds. */
    });
    heartbeat.mockImplementation(() => {
      throw new Error("Heartbeat rejected");
    });
    const operation = withActivityHeartbeat(
      { heartbeat, cancellationSignal: new AbortController().signal },
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(new Error("Heartbeat rejected", { cause: signal.reason })),
            {
              once: true,
            },
          );
        }),
      { stage: "start", completed: 0, total: 100 },
    );
    const assertion = expect(operation).rejects.toThrow("Heartbeat rejected");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
