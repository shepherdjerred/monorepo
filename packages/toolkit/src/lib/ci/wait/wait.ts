import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import { isTransientGitHubTransportError } from "#lib/ci/github.ts";
import { RESUME_SPREAD_MS } from "#lib/ci/github/budget.ts";
import { sleep } from "#lib/ci/wait/sleep.ts";
import {
  evaluateReadiness,
  type MainPolicy,
  type Snapshot,
  type Verdict,
} from "#lib/ci/readiness.ts";
import { WoodpeckerHttpError } from "#lib/woodpecker/ci.ts";

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
  /** Reports a retriable upstream HTTP/transport failure during polling. */
  transientError?: (error: unknown, attempt: number) => void;
};
export type WaitLoopOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
  maxConsecutiveErrors?: number;
  /**
   * Event bursts coalesce: a wake within this long of the previous
   * event-driven snapshot waits out the rest of the gap. Default 5s.
   */
  eventGapMs?: number;
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

const TRANSIENT_NETWORK =
  /unable to connect|failed to fetch|socket connection was closed|connection reset by peer|TLS handshake timeout|unexpected EOF|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|network connection/iu;

const MAX_CONSECUTIVE_SNAPSHOT_ERRORS = 20;
const MAX_TRANSIENT_QUOTA_READ_RETRIES = 3;

/**
 * A 30s snapshot deadline, upstream 5xx/429 gateway blip, or dropped socket is
 * not a CI result. The Woodpecker event-stream connect timer uses a different
 * message and must end the wait. Caller abort is checked separately.
 */
export function isRetriableSnapshotError(error: unknown): boolean {
  if (
    !(error instanceof Error) ||
    error.name === "AbortError" ||
    error.message === "Woodpecker event connection timed out"
  ) {
    return false;
  }
  return error instanceof WoodpeckerHttpError
    ? error.status >= 500 || error.status === 429
    : /^GitHub (?:request|GraphQL) failed \(5\d\d\)/u.test(error.message) ||
        error.name === "TimeoutError" ||
        error.message === "The operation timed out." ||
        isTransientGitHubTransportError(error) ||
        TRANSIENT_NETWORK.test(error.message);
}

/**
 * Sleep until GitHub's quota resets, plus a random share of the resume window
 * so twenty or thirty waiters refused together do not all retry in the same
 * second. Woodpecker events are ignored meanwhile: every refused read needs
 * GitHub, so waking early would only be refused again.
 */
export async function sleepUntilRateLimitReset(
  error: GitHubRateLimitError,
  signal: AbortSignal,
  onWait?: (error: GitHubRateLimitError, resumeAt: number) => void,
): Promise<void> {
  const resumeAt =
    error.resumeAt + Math.floor(Math.random() * RESUME_SPREAD_MS);
  onWait?.(error, resumeAt);
  await sleep(Math.max(0, resumeAt - Date.now()), signal);
}

export type ReadThroughQuotaCallbacks =
  | ((error: GitHubRateLimitError, resumeAt: number) => void)
  | {
      rateLimited?:
        ((error: GitHubRateLimitError, resumeAt: number) => void) | undefined;
      transientError?: ((error: unknown, attempt: number) => void) | undefined;
    };

function normalizeQuotaCallbacks(callbacks?: ReadThroughQuotaCallbacks): {
  rateLimited?:
    ((error: GitHubRateLimitError, resumeAt: number) => void) | undefined;
  transientError?: ((error: unknown, attempt: number) => void) | undefined;
} {
  if (callbacks === undefined) {
    return {};
  }
  return typeof callbacks === "function"
    ? { rateLimited: callbacks }
    : callbacks;
}

async function waitTransientQuotaRetry(options: {
  error: unknown;
  attempt: number;
  signal: AbortSignal;
  deadline: number | null;
  onTransient?: ((error: unknown, attempt: number) => void) | undefined;
}): Promise<"retry" | "timeout"> {
  const { error, attempt, signal, deadline, onTransient } = options;
  if (deadline !== null && Date.now() >= deadline) {
    return "timeout";
  }
  onTransient?.(error, attempt);
  const baseMs = Bun.env.NODE_ENV === "test" ? 5 : 1000 * 2 ** (attempt - 1);
  const waitMs =
    deadline === null
      ? baseMs
      : Math.max(0, Math.min(baseMs, deadline - Date.now()));
  await sleep(waitMs, signal);
  return deadline !== null && Date.now() >= deadline ? "timeout" : "retry";
}

async function waitRateLimitQuotaRetry(
  error: GitHubRateLimitError,
  signal: AbortSignal,
  deadline: number | null,
  onWait?: (error: GitHubRateLimitError, resumeAt: number) => void,
): Promise<"retry" | "timeout"> {
  if (deadline !== null && error.resumeAt > deadline) {
    return "timeout";
  }
  await sleepUntilRateLimitReset(error, signal, onWait);
  return deadline !== null && Date.now() >= deadline ? "timeout" : "retry";
}

async function handleQuotaReadError(options: {
  error: unknown;
  transientAttempts: number;
  signal: AbortSignal;
  deadline: number | null;
  rateLimited?:
    ((error: GitHubRateLimitError, resumeAt: number) => void) | undefined;
  transientError?: ((error: unknown, attempt: number) => void) | undefined;
}): Promise<{ step: "retry" | "timeout"; transientAttempts: number }> {
  const { error, transientAttempts, signal, deadline } = options;
  if (error instanceof GitHubRateLimitError) {
    const step = await waitRateLimitQuotaRetry(
      error,
      signal,
      deadline,
      options.rateLimited,
    );
    return { step, transientAttempts: 0 };
  }
  const canRetry =
    !signal.aborted &&
    transientAttempts < MAX_TRANSIENT_QUOTA_READ_RETRIES &&
    isRetriableSnapshotError(error);
  if (!canRetry) {
    throw error;
  }
  const attempt = transientAttempts + 1;
  const step = await waitTransientQuotaRetry({
    error,
    attempt,
    signal,
    deadline,
    onTransient: options.transientError,
  });
  return { step, transientAttempts: attempt };
}

/**
 * One GitHub read that waits out quota refusals and bounded transient errors.
 * Returns null when the caller's deadline arrives first, so the caller can
 * report a timeout instead of an error.
 */
export async function readThroughQuota<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
  deadline: number | null,
  callbacks?: ReadThroughQuotaCallbacks,
): Promise<T | null> {
  const { rateLimited, transientError } = normalizeQuotaCallbacks(callbacks);
  let transientAttempts = 0;
  for (;;) {
    try {
      return await read();
    } catch (error) {
      const outcome = await handleQuotaReadError({
        error,
        transientAttempts,
        signal,
        deadline,
        rateLimited,
        transientError,
      });
      if (outcome.step === "timeout") {
        return null;
      }
      transientAttempts = outcome.transientAttempts;
    }
  }
}

function notifier(eventGapMs: number) {
  const state = { dirty: false };
  let notify: (() => void) | null = null;
  // When the last event-driven wait returned; timer wakes do not count.
  let lastEventAt = Number.NEGATIVE_INFINITY;
  /** An event ended this wait; a burst behind the last one waits out the gap. */
  const coalesce = async (signal: AbortSignal) => {
    const remaining = lastEventAt + eventGapMs - Date.now();
    if (remaining > 0) await sleep(remaining, signal);
    lastEventAt = Date.now();
  };
  return {
    wake: () => {
      state.dirty = true;
      notify?.();
    },
    wait: async (ms: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!state.dirty)
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
      signal.throwIfAborted();
      if (state.dirty) await coalesce(signal);
      state.dirty = false;
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

/**
 * A ready PR candidate is accepted only after a forced, unchanged re-read. Any
 * other terminal verdict not judged on a forced read is judged again on one,
 * so no reported verdict rests on reused GitHub state.
 */
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
  if (verdict.outcome === "waiting") return { snapshot, verdict };
  if (verdict.outcome !== "ready") {
    if (snapshot.githubFresh === true) return { snapshot, verdict };
    const fresh = await reread(signal, true);
    return {
      snapshot: fresh,
      verdict: evaluateReadiness(
        fresh,
        options.head,
        options.until,
        options.mainPolicy,
      ),
    };
  }
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

async function handleSnapshotError<S>(
  context: WaitContext<S>,
  error: unknown,
  consecutiveErrors: number,
  maxConsecutiveErrors: number,
): Promise<number> {
  if (error instanceof GitHubRateLimitError) {
    await sleepUntilRateLimitReset(
      error,
      context.signal,
      context.dependencies.rateLimited,
    );
    return consecutiveErrors;
  }
  // A snapshot's own 30s timer, upstream 5xx/429, or dropped socket is retried
  // up to maxConsecutiveErrors. Caller aborts, contract errors, and the
  // initial event-stream connect timeout fail immediately.
  if (!context.signal.aborted && isRetriableSnapshotError(error)) {
    const next = consecutiveErrors + 1;
    if (next >= maxConsecutiveErrors) {
      throw error;
    }
    context.dependencies.transientError?.(error, next);
    const backoffMs =
      context.options.pollMs ?? Math.min(30_000, 1000 * 2 ** (next - 1));
    await context.updates.wait(backoffMs, context.signal);
    return next;
  }
  throw error;
}

async function runLoop<S>(context: WaitContext<S>): Promise<LoopResult<S>> {
  let heartbeatAt = context.started;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors =
    context.options.maxConsecutiveErrors ?? MAX_CONSECUTIVE_SNAPSHOT_ERRORS;
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
      consecutiveErrors = await handleSnapshotError(
        context,
        error,
        consecutiveErrors,
        maxConsecutiveErrors,
      );
      continue;
    }
    consecutiveErrors = 0;
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
    updates: notifier(options.eventGapMs ?? 5000),
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
