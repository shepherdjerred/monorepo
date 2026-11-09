import { afterEach, describe, expect, test, vi } from "vitest";
import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import {
  isRetriableSnapshotError,
  waitFor,
  waitForCi,
  type WaitDependencies,
} from "#lib/ci/wait/wait.ts";
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

function exhausted(resumeAt: number): GitHubRateLimitError {
  return new GitHubRateLimitError("/repos/o/r/pulls/1", {
    status: 403,
    resource: "core",
    limit: 5000,
    used: 5000,
    remaining: 0,
    resetAt: new Date(resumeAt),
    retryAfterSeconds: null,
  });
}

describe("GitHub rate limits during a wait", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("waits for the reset and keeps polling instead of failing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let calls = 0;
    const deps = dependencies(async () => {
      calls++;
      if (calls === 1) throw exhausted(Date.now());
      return ciFixture();
    });
    const rateLimited = vi.fn();
    deps.rateLimited = rateLimited;
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure" },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(rateLimited).toHaveBeenCalledTimes(1);
    expect(rateLimited.mock.calls[0]?.[0]).toBeInstanceOf(GitHubRateLimitError);
  });

  test("a reset beyond the requested deadline reports timeout", async () => {
    const deps = dependencies(async () => {
      throw exhausted(Date.now() + 3_600_000);
    });
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", timeoutMs: 20 },
      deps,
    );
    expect(result.verdict.outcome).toBe("timeout");
  });

  test("other GitHub failures still end the wait", async () => {
    const deps = dependencies(async () => {
      throw new Error("GitHub request failed (404): /repos/o/r/pulls/1");
    });
    await expect(
      waitForCi({ head: CI_HEAD, until: "first-failure" }, deps),
    ).rejects.toThrow("404");
  });
});

function snapshotTimeout(): Error {
  const error = new Error("The operation timed out.");
  error.name = "TimeoutError";
  return error;
}

describe("snapshot timeouts during a wait", () => {
  test("retries a timed-out snapshot and still reports CI", async () => {
    let calls = 0;
    const deps = dependencies(async () => {
      calls += 1;
      if (calls === 1) throw snapshotTimeout();
      return ciFixture();
    });
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", pollMs: 1 },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(calls).toBeGreaterThan(1);
  });

  test("retries one dropped connection", async () => {
    let calls = 0;
    const deps = dependencies(async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError(
          "Unable to connect. Is the computer able to access the url?",
        );
      }
      return ciFixture();
    });
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", pollMs: 1 },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
  });

  test("does not retry after the caller aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const deps = dependencies(async () => {
      calls += 1;
      controller.abort();
      throw snapshotTimeout();
    });
    await expect(
      waitForCi(
        { head: CI_HEAD, until: "first-failure", signal: controller.signal },
        deps,
      ),
    ).rejects.toThrow(/timed out|aborted/iu);
    expect(calls).toBe(1);
  });

  test("does not retry a contract error or the event-stream connect timeout", () => {
    expect(
      isRetriableSnapshotError(new Error("snapshot schema mismatch")),
    ).toBe(false);
    expect(
      isRetriableSnapshotError(
        new Error("Woodpecker event connection timed out"),
      ),
    ).toBe(false);
    expect(isRetriableSnapshotError(snapshotTimeout())).toBe(true);
  });
  test("a ready PR keeps waiting through a red main when main is required", async () => {
    let calls = 0;
    const deps = dependencies(async () => {
      calls++;
      const snapshot = ciFixture();
      if (calls <= 2) snapshot.main.state = "red";
      return snapshot;
    });
    const result = await waitForCi(
      {
        head: CI_HEAD,
        until: "first-failure",
        mainPolicy: "require",
        pollMs: 1,
      },
      deps,
    );
    expect(result.verdict.outcome).toBe("ready");
    expect(result.snapshot?.main.state).toBe("pending");
    expect(calls).toBe(4);
  });

  test("the default policy reports a red main only after the PR is ready", async () => {
    let calls = 0;
    const deps = dependencies(async () => {
      calls++;
      const snapshot = calls === 1 ? pendingCi() : ciFixture();
      snapshot.main.state = "red";
      return snapshot;
    });
    const result = await waitForCi(
      { head: CI_HEAD, until: "first-failure", pollMs: 1 },
      deps,
    );
    expect(result.verdict.outcome).toBe("main_red");
    expect(calls).toBe(2);
  });

  test("the generic loop accepts any snapshot and verdict", async () => {
    let calls = 0;
    const result = await waitFor<number>(
      { pollMs: 1 },
      {
        snapshot: async () => ++calls,
        evaluate: async (count) => ({
          snapshot: count,
          verdict: {
            outcome: count < 3 ? "waiting" : "failure",
            reasons: [],
            commands: [],
          },
        }),
        heartbeat: vi.fn(),
        subscribe: (signal, _wake, connected) =>
          subscription(signal, connected),
      },
    );
    expect(result.verdict.outcome).toBe("failure");
    expect(result.snapshot).toBe(3);
  });
});
