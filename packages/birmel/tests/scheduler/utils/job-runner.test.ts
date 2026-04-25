import { describe, test, expect } from "bun:test";
import {
  runScheduledJob,
  throwIfAborted,
} from "@shepherdjerred/birmel/scheduler/utils/job-runner.ts";

describe("throwIfAborted", () => {
  test("does not throw when signal is not aborted", () => {
    const ac = new AbortController();
    expect(() => {
      throwIfAborted(ac.signal);
    }).not.toThrow();
  });

  test("rethrows the abort reason when aborted with an Error", () => {
    const ac = new AbortController();
    const reason = new Error("boom");
    ac.abort(reason);
    expect(() => {
      throwIfAborted(ac.signal);
    }).toThrow("boom");
  });

  test("throws when aborted without an explicit reason", () => {
    // Web spec: `AbortController.abort()` with no argument sets a
    // DOMException with name "AbortError" as the reason. Verify we
    // surface that error rather than silently dropping the abort.
    const ac = new AbortController();
    ac.abort();
    let thrown: unknown;
    try {
      throwIfAborted(ac.signal);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    if (!(thrown instanceof Error)) {
      throw new Error("expected an Error instance");
    }
    expect(thrown.name).toBe("AbortError");
  });
});

describe("runScheduledJob", () => {
  test("invokes the body once and resolves on success", async () => {
    let callCount = 0;
    await runScheduledJob({ name: "test-success" }, async () => {
      callCount += 1;
      await Promise.resolve();
    });
    expect(callCount).toBe(1);
  });

  test("does not propagate body errors out of runScheduledJob", async () => {
    // A scheduler tick should never reject — failures are logged, not thrown.
    let calls = 0;
    await runScheduledJob({ name: "test-error" }, async () => {
      calls += 1;
      await Promise.resolve();
      throw new Error("boom");
    });
    expect(calls).toBe(1);
  });

  test("passes an AbortSignal to the body", async () => {
    let observed: AbortSignal | undefined;
    await runScheduledJob({ name: "test-signal" }, async (signal) => {
      observed = signal;
      await Promise.resolve();
    });
    expect(observed).toBeInstanceOf(AbortSignal);
  });

  test("aborts the body when the timeout elapses", async () => {
    let aborted = false;
    await runScheduledJob(
      { name: "test-timeout", timeoutMs: 50 },
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
          // intentionally never resolve on its own — the abort handler does
        });
      },
    );
    expect(aborted).toBe(true);
  });

  test("does not abort when the body finishes before the timeout", async () => {
    let observedAborted = false;
    await runScheduledJob(
      { name: "test-fast", timeoutMs: 60_000 },
      async (signal) => {
        await Promise.resolve();
        observedAborted = signal.aborted;
      },
    );
    expect(observedAborted).toBe(false);
  });
});
