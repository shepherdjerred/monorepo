import { describe, expect, test, vi } from "vitest";
import { waitForCi, type WaitDependencies } from "#lib/ci/wait.ts";
import { ciFixture, pendingCi, CI_HEAD } from "./fixtures.ts";

function subscription(
  signal: AbortSignal,
  connected: () => void,
): Promise<void> {
  connected();
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

function dependencies(
  snapshot: WaitDependencies["snapshot"],
): WaitDependencies {
  return {
    snapshot,
    heartbeat: vi.fn(),
    subscribe: (signal, _wake, connected) => subscription(signal, connected),
  };
}

describe("foreground CI wait", () => {
  test("subscribes before reading and force-refreshes a ready candidate", async () => {
    const order: string[] = [];
    const deps = dependencies(async (_signal, force) => {
      order.push(force ? "final" : "snapshot");
      return ciFixture();
    });
    deps.subscribe = (signal, _wake, connected) => {
      order.push("subscribe");
      return subscription(signal, connected);
    };
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure" },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(order).toEqual(["subscribe", "snapshot", "final"]);
  });
  test("events wake a pending wait and subscription is closed at completion", async () => {
    let wake: (() => void) | undefined;
    let aborted = false;
    let calls = 0;
    const deps = dependencies(async () => {
      calls++;
      if (calls === 1) {
        queueMicrotask(() => {
          wake?.();
        });
        return pendingCi();
      }
      return ciFixture();
    });
    deps.subscribe = (signal, notify, connected) => {
      wake = notify;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return subscription(signal, connected);
    };
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure" },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(aborted).toBe(true);
    expect(calls).toBe(3);
  });
  test("returns an early failure without waiting for sibling workflows", async () => {
    const snapshot = pendingCi();
    snapshot.pipeline?.workflows.push({ name: "lint", state: "failure" });
    const read = vi.fn(async () => snapshot);
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure" },
      dependencies(read),
    );
    expect(result.verdict.outcome).toBe("failure");
    expect(read).toHaveBeenCalledTimes(1);
  });
  test("requested deadline reports timeout rather than CI failure", async () => {
    const deps = dependencies(async () => pendingCi());
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", timeoutMs: 20 },
      deps,
    );
    expect(result.verdict.outcome).toBe("timeout");
    expect(result.snapshot?.pipeline?.status).toBe("running");
  });
  test("final read catches head movement", async () => {
    const final = ciFixture();
    final.pr.head.sha = "c".repeat(40);
    const read = vi
      .fn()
      .mockResolvedValueOnce(ciFixture())
      .mockResolvedValue(final);
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure" },
      dependencies(read),
    );
    expect(result.verdict.outcome).toBe("head_changed");
  });
  test("base and rerun changes require another stable final read", async () => {
    const changed = ciFixture();
    changed.pr.base.sha = "c".repeat(40);
    if (changed.pipeline !== null) changed.pipeline.rerun_count = 1;
    const read = vi
      .fn()
      .mockResolvedValueOnce(ciFixture())
      .mockResolvedValue(changed);
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", pollMs: 1 },
      dependencies(read),
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(read).toHaveBeenCalledTimes(4);
  });
  test("cancellation aborts work and does not turn into timeout", async () => {
    const controller = new AbortController();
    const deps = dependencies(async () => {
      queueMicrotask(() => {
        controller.abort(new Error("interrupted"));
      });
      return pendingCi();
    });
    await expect(
      waitForCi(
        { head: CI_HEAD, until: "first-failure", signal: controller.signal },
        deps,
      ),
    ).rejects.toThrow("interrupted");
    await expect(
      waitForCi(
        { head: CI_HEAD, until: "first-failure", signal: controller.signal },
        deps,
      ),
    ).rejects.toThrow("interrupted");
  });
  test("fatal event contract errors surface even during snapshot collection", async () => {
    let fatal: ((error: unknown) => void) | undefined;
    const deps = dependencies(async () => {
      fatal?.(new Error("invalid event"));
      return ciFixture();
    });
    deps.subscribe = (signal, _wake, connected, fail) => {
      fatal = fail;
      return subscription(signal, connected);
    };
    await expect(
      waitForCi({ head: CI_HEAD, until: "first-failure" }, deps),
    ).rejects.toThrow("invalid event");
  });
});
