import { setTimeout as delay } from "node:timers/promises";
import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import {
  evaluateReadiness,
  type MainPolicy,
  type Snapshot,
  type Verdict,
} from "#lib/ci/readiness.ts";

type Subscribe = (
  signal: AbortSignal,
  wake: () => void,
  connected: () => void,
  fatal: (error: unknown) => void,
) => Promise<void>;

/** Everything a foreground wait needs besides how to judge a snapshot. */
export type WaitLoopDependencies<S> = {
  snapshot: (signal: AbortSignal, force: boolean) => Promise<S>;
  /** Judge a fresh snapshot; may re-read before accepting a terminal verdict. */
  evaluate: (
    snapshot: S,
    signal: AbortSignal,
  ) => Promise<{ snapshot: S; verdict: Verdict }>;
  subscribe: Subscribe;
  heartbeat: (snapshot: S | null) => void;
  /** Reports that GitHub refused a read on quota and when polling resumes. */
  rateLimited?: (error: GitHubRateLimitError, resumeAt: number) => void;
};
export type WaitLoopOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
};
export type LoopResult<S> = {
  snapshot: S | null;
  verdict: Verdict;
  elapsedMs: number;
};

export type WaitDependencies = Omit<WaitLoopDependencies<Snapshot>, "evaluate">;
export type WaitOptions = WaitLoopOptions & {
  head: string;
  until: "first-failure" | "settled";
  mainPolicy?: MainPolicy;
};
export type WaitResult = LoopResult<Snapshot>;

/** The requested deadline elapsed; that says nothing about CI itself. */
export function timeoutResult<S>(
  snapshot: S | null,
  started: number,
): LoopResult<S> {
  return {
    snapshot,
    verdict: {
      outcome: "timeout",
      reasons: [
        "The requested wait deadline elapsed. This does not mean CI failed.",
      ],
      commands: ["toolkit ci load"],
    },
    elapsedMs: Date.now() - started,
  };
}

/** Spread concurrent waiters so they do not all retry at the same reset. */
const RATE_LIMIT_JITTER_MS = 5000;

const TRANSIENT_NETWORK =
  /unable to connect|failed to fetch|socket connection was closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|network connection/iu;

/**
 * A 30s snapshot deadline or a dropped connection is not a CI result. The
 * Woodpecker event-stream connect timer uses a different message and must
 * end the wait. Caller abort is checked separately.
 */
export function isRetriableSnapshotError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message !== "Woodpecker event connection timed out" &&
    (error.name === "TimeoutError" ||
      error.message === "The operation timed out." ||
      (error instanceof TypeError && TRANSIENT_NETWORK.test(error.message)))
  );
}

/**
 * Sleep until GitHub's quota resets. Woodpecker events are ignored meanwhile:
 * every snapshot needs GitHub, so waking early would only be refused again.
 */
export async function sleepUntilRateLimitReset(
  error: GitHubRateLimitError,
  signal: AbortSignal,
  onWait?: (error: GitHubRateLimitError, resumeAt: number) => void,
): Promise<void> {
  const resumeAt =
    error.resumeAt + Math.floor(Math.random() * RATE_LIMIT_JITTER_MS);
  onWait?.(error, resumeAt);
  await delay(Math.max(0, resumeAt - Date.now()), undefined, { signal });
}

/**
 * One GitHub read that waits out quota refusals like every later poll.
 * Returns null when the caller's deadline arrives first, so the caller can
 * report a timeout instead of an error.
 */
export async function readThroughQuota<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
  deadline: number | null,
  onWait?: (error: GitHubRateLimitError, resumeAt: number) => void,
): Promise<T | null> {
  for (;;) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof GitHubRateLimitError)) throw error;
      if (deadline !== null && error.resumeAt > deadline) return null;
      await sleepUntilRateLimitReset(error, signal, onWait);
      if (deadline !== null && Date.now() >= deadline) return null;
    }
  }
}

function notifier() {
  let dirty = false;
  let notify: (() => void) | null = null;
  return {
    wake: () => {
      dirty = true;
      notify?.();
    },
    wait: async (ms: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (dirty) {
        dirty = false;
        return;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          notify = null;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        notify = finish;
        signal.addEventListener("abort", finish, { once: true });
      });
      dirty = false;
      signal.throwIfAborted();
    },
  };
}

type WaitContext<S> = {
  options: WaitLoopOptions;
  dependencies: WaitLoopDependencies<S>;
  signal: AbortSignal;
  updates: ReturnType<typeof notifier>;
  started: number;
  snapshot: S | null;
  streamError: Error | null;
};

function assertStream<S>(context: WaitContext<S>): void {
  if (context.streamError !== null) throw context.streamError;
}

/** A ready PR candidate is accepted only after a forced, unchanged re-read. */
async function candidate(
  options: WaitOptions,
  reread: WaitDependencies["snapshot"],
  snapshot: Snapshot,
  signal: AbortSignal,
): Promise<{ snapshot: Snapshot; verdict: Verdict }> {
  const verdict = evaluateReadiness(
    snapshot,
    options.head,
    options.until,
    options.mainPolicy,
  );
  if (verdict.outcome !== "ready") return { snapshot, verdict };
  const final = await reread(signal, true);
  const checked = evaluateReadiness(
    final,
    options.head,
    options.until,
    options.mainPolicy,
  );
  const changed =
    final.pr.base.sha !== snapshot.pr.base.sha ||
    final.pipeline?.number !== snapshot.pipeline?.number ||
    final.pipeline?.rerun_count !== snapshot.pipeline?.rerun_count;
  return {
    snapshot: final,
    verdict:
      changed && checked.outcome === "ready"
        ? {
            outcome: "waiting",
            reasons: [
              "Merge inputs changed; rechecking the current base and pipeline attempt.",
            ],
            commands: [],
          }
        : checked,
  };
}

async function runLoop<S>(context: WaitContext<S>): Promise<LoopResult<S>> {
  let heartbeatAt = context.started;
  for (;;) {
    context.signal.throwIfAborted();
    assertStream(context);
    let result: { snapshot: S; verdict: Verdict };
    try {
      const current = await context.dependencies.snapshot(
        context.signal,
        false,
      );
      result = await context.dependencies.evaluate(current, context.signal);
    } catch (error) {
      if (error instanceof GitHubRateLimitError) {
        await sleepUntilRateLimitReset(
          error,
          context.signal,
          context.dependencies.rateLimited,
        );
        continue;
      }
      // The snapshot's own 30s timer aborts that read. The wait itself is
      // still running, so the next poll tries again. A caller abort, a real
      // CI failure, and the event-stream connect timeout do not.
      if (!context.signal.aborted && isRetriableSnapshotError(error)) {
        await context.updates.wait(
          context.options.pollMs ?? 30_000,
          context.signal,
        );
        continue;
      }
      throw error;
    }
    context.snapshot = result.snapshot;
    context.signal.throwIfAborted();
    assertStream(context);
    if (result.verdict.outcome !== "waiting")
      return { ...result, elapsedMs: Date.now() - context.started };
    if (Date.now() - heartbeatAt >= (context.options.heartbeatMs ?? 300_000)) {
      context.dependencies.heartbeat(context.snapshot);
      heartbeatAt = Date.now();
    }
    await context.updates.wait(
      context.options.pollMs ?? 30_000,
      context.signal,
    );
  }
}

async function subscribe<S>(
  context: WaitContext<S>,
  connection: { resolve: () => void; reject: (error: unknown) => void },
): Promise<void> {
  const fatal = (error: unknown) => {
    context.streamError =
      error instanceof Error ? error : new Error(String(error));
    connection.reject(context.streamError);
    context.updates.wake();
  };
  try {
    await context.dependencies.subscribe(
      context.signal,
      context.updates.wake,
      () => {
        connection.resolve();
      },
      fatal,
    );
  } catch (error) {
    fatal(error);
  }
}

/** One foreground process; events coalesce and ordinary waiting has no deadline. */
export async function waitFor<S>(
  options: WaitLoopOptions,
  dependencies: WaitLoopDependencies<S>,
): Promise<LoopResult<S>> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, options.signal]);
  const context: WaitContext<S> = {
    options,
    dependencies,
    signal,
    updates: notifier(),
    started: Date.now(),
    snapshot: null,
    streamError: null,
  };
  const connection = Promise.withResolvers<undefined>();
  const connectTimer = setTimeout(() => {
    connection.reject(new Error("Woodpecker event connection timed out"));
  }, 30_000);
  const abortConnection = () => {
    connection.reject(signal.reason);
  };
  signal.addEventListener("abort", abortConnection, { once: true });
  const subscription = subscribe(context, {
    resolve: () => {
      connection.resolve(undefined);
    },
    reject: connection.reject,
  });
  const deadline =
    options.timeoutMs === undefined
      ? null
      : setTimeout(() => {
          controller.abort(new Error("CI wait deadline reached"));
        }, options.timeoutMs);
  try {
    await connection.promise;
    clearTimeout(connectTimer);
    signal.removeEventListener("abort", abortConnection);
    return await runLoop(context);
  } catch (error) {
    if (options.signal?.aborted === true) throw error;
    if (!controller.signal.aborted) throw error;
    return timeoutResult(context.snapshot, context.started);
  } finally {
    if (deadline !== null) clearTimeout(deadline);
    clearTimeout(connectTimer);
    signal.removeEventListener("abort", abortConnection);
    controller.abort();
    await subscription;
  }
}

/** Wait for one pinned PR head to become merge-ready or actionable. */
export async function waitForCi(
  options: WaitOptions,
  dependencies: WaitDependencies,
): Promise<WaitResult> {
  return waitFor(options, {
    ...dependencies,
    evaluate: (snapshot, signal) =>
      candidate(options, dependencies.snapshot, snapshot, signal),
  });
}
