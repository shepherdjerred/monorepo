import type {
  FeedbackClaimResponse,
  FeedbackItem,
} from "@shepherdjerred/artifacts/contract";
import { sleep } from "#lib/ci/wait/sleep.ts";
import { ArtifactsCliError } from "./errors.ts";
import type { LiveEvent } from "./live.ts";

/**
 * The push-style wait for human feedback.
 *
 * `waitFor` in `lib/ci/wait` is not reused: it is built around one pinned CI
 * snapshot judged by `evaluate`, ends the whole wait when its single event
 * subscription fails (a "connection timed out" message is CI wording), and has
 * no notion of claiming and acknowledging work. This loop needs the opposite
 * failure policy: a dropped stream is routine, so the subscriber reconnects
 * with backoff and the claim is the only source of truth.
 *
 * Ordering is the correctness argument. The subscriber starts before the first
 * claim, so a comment posted between the two wakes the loop instead of being
 * missed. Every connect, `ready`, `feedback`, `resync`, and a 60 s tick claim
 * again, so a lost event only delays delivery. Items are presented, and only
 * then acknowledged, so a crash in between redelivers rather than loses them.
 */
export type WaitDeps = {
  /** Claim every deliverable comment in the pinned scope. */
  claim: (signal: AbortSignal) => Promise<FeedbackClaimResponse>;
  /** Acknowledge delivered comments. Not cancelled by the wait's own signal. */
  ack: (commentIds: string[]) => Promise<void>;
  /** One connection to the live stream; ends or throws when it drops. */
  stream: (signal: AbortSignal) => AsyncIterable<LiveEvent>;
  /** Write the items and resolve once they are flushed to stdout. */
  present: (items: FeedbackItem[]) => Promise<void>;
  heartbeat?: (info: { elapsedMs: number; connected: boolean }) => void;
  /** Called before each reconnect attempt, for a stderr note. */
  reconnecting?: (error: unknown, delayMs: number) => void;
};

export type WaitOptions = {
  timeoutMs?: number | undefined;
  /** Aborting it ends the wait as `interrupted` (SIGINT or SIGTERM). */
  signal?: AbortSignal | undefined;
  /** Claim at least this often whatever the stream says. Default 60 s. */
  pollMs?: number;
  /** Default 5 min. */
  heartbeatMs?: number;
  /** Reconnect backoff. Default 1 s doubling to 30 s, with jitter. */
  backoff?: { baseMs: number; maxMs: number };
  random?: () => number;
  /** How long the first claim waits for the stream to connect. Default 10 s. */
  connectGraceMs?: number;
  /** An explicit board or artifact that no longer exists ends the wait as gone. */
  notFoundIsGone?: boolean;
  ackAttempts?: number;
  ackRetryMs?: number;
};

export type WaitResult =
  | { outcome: "feedback"; items: FeedbackItem[]; ackError?: unknown }
  | { outcome: "timeout" }
  | { outcome: "gone" }
  | { outcome: "interrupted" };

const DEFAULT_BACKOFF = { baseMs: 1000, maxMs: 30_000 };
/** A connection that lived this long was healthy: its next retry starts at base. */
const HEALTHY_CONNECTION_MS = 10_000;
/** Claim a little after a settle window ends, never before. */
const SETTLE_MARGIN_MS = 250;
const MIN_SLEEP_MS = 50;

/** Delay before retry `attempt` (0-based): exponential, capped, 50-100 % jitter. */
export function backoffDelay(
  attempt: number,
  backoff: { baseMs: number; maxMs: number },
  random: () => number,
): number {
  const ceiling = Math.min(backoff.maxMs, backoff.baseMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

/** A coalescing wake-up: one signal while nobody waits is kept for the next wait. */
function createWake() {
  let pending = false;
  let release: (() => void) | null = null;
  return {
    signal(): void {
      pending = true;
      release?.();
    },
    /** Forget wake-ups so far: a claim that starts now already reflects them. */
    reset(): void {
      pending = false;
    },
    async waitUntil(ms: number, signal: AbortSignal): Promise<void> {
      if (pending) {
        pending = false;
        return;
      }
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          release = null;
          pending = false;
          resolve();
        };
        const abort = () => {
          clearTimeout(timer);
          release = null;
          const reason: unknown = signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error("aborted", { cause: reason }),
          );
        };
        const timer = setTimeout(finish, ms);
        release = finish;
        signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
}

type Context = {
  deps: WaitDeps;
  signal: AbortSignal;
  backoff: { baseMs: number; maxMs: number };
  random: () => number;
  wake: ReturnType<typeof createWake>;
  connected: boolean;
  gone: boolean;
  fatal: Error | null;
  notFoundIsGone: boolean;
  firstContact: PromiseWithResolvers<undefined>;
};

const hasStopped = (context: Context): boolean =>
  context.signal.aborted || context.gone;

async function consumeStream(context: Context): Promise<"gone" | "ended"> {
  for await (const event of context.deps.stream(context.signal)) {
    if (event.type === "open") {
      context.connected = true;
      context.firstContact.resolve(undefined);
      context.wake.signal();
      continue;
    }
    const kind = event.message.type;
    if (kind === "gone") {
      context.gone = true;
      context.wake.signal();
      return "gone";
    }
    if (kind === "feedback" || kind === "ready" || kind === "resync")
      context.wake.signal();
  }
  return "ended";
}

/** A stream refused for good ends the wait: as gone, or with the error. */
function endForGood(context: Context, error: ArtifactsCliError): void {
  // A named board or artifact the service no longer knows is gone, not broken.
  if (context.notFoundIsGone && error.kind === "not-found") context.gone = true;
  else context.fatal = error;
  context.wake.signal();
}

/** Keeps one stream connected until the wait ends, reconnecting with backoff. */
async function subscribe(context: Context): Promise<void> {
  let attempt = 0;
  while (!hasStopped(context)) {
    const started = Date.now();
    let error: unknown = null;
    try {
      if ((await consumeStream(context)) === "gone") return;
    } catch (error_) {
      error = error_;
    }
    context.connected = false;
    if (hasStopped(context)) return;
    // A stream that failed to connect must not hold the first claim back.
    context.firstContact.resolve(undefined);
    if (error instanceof ArtifactsCliError && !error.transient) {
      endForGood(context, error);
      return;
    }
    if (Date.now() - started >= HEALTHY_CONNECTION_MS) attempt = 0;
    const delay = backoffDelay(attempt++, context.backoff, context.random);
    context.deps.reconnecting?.(error, delay);
    try {
      await sleep(delay, context.signal);
    } catch {
      return;
    }
  }
}

async function ackWithRetry(
  deps: WaitDeps,
  items: readonly FeedbackItem[],
  options: WaitOptions,
): Promise<unknown> {
  const ids = items.map((item) => item.comment.id);
  const attempts = options.ackAttempts ?? 3;
  let last: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deps.ack(ids);
      return null;
    } catch (error) {
      last = error;
      if (attempt < attempts)
        await new Promise((resolve) =>
          setTimeout(resolve, (options.ackRetryMs ?? 500) * attempt),
        );
    }
  }
  return last;
}

/** Waits until human feedback arrives, the scope is gone, or time runs out. */
export async function waitForFeedback(
  deps: WaitDeps,
  options: WaitOptions = {},
): Promise<WaitResult> {
  const internal = new AbortController();
  const signal =
    options.signal === undefined
      ? internal.signal
      : AbortSignal.any([internal.signal, options.signal]);
  const started = Date.now();
  const context: Context = {
    deps,
    signal,
    backoff: options.backoff ?? DEFAULT_BACKOFF,
    random: options.random ?? Math.random,
    wake: createWake(),
    connected: false,
    gone: false,
    fatal: null,
    notFoundIsGone: options.notFoundIsGone === true,
    firstContact: Promise.withResolvers<undefined>(),
  };
  const deadlineState: { timedOut: boolean } = { timedOut: false };
  const deadline =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          deadlineState.timedOut = true;
          internal.abort();
        }, options.timeoutMs);
  const heartbeat = setInterval(() => {
    deps.heartbeat?.({
      elapsedMs: Date.now() - started,
      connected: context.connected,
    });
  }, options.heartbeatMs ?? 300_000);

  // Subscribe first: a comment landing before the claim must still wake us.
  const subscriber = subscribe(context);
  try {
    await firstContact(context, options.connectGraceMs ?? 10_000);
    return await claimLoop(context, options);
  } catch (error) {
    if (deadlineState.timedOut) return { outcome: "timeout" };
    if (options.signal?.aborted === true) return { outcome: "interrupted" };
    throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    clearInterval(heartbeat);
    internal.abort();
    await subscriber;
  }
}

async function firstContact(context: Context, graceMs: number): Promise<void> {
  const grace = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => {
    grace.resolve(undefined);
  }, graceMs);
  try {
    await Promise.race([context.firstContact.promise, grace.promise]);
  } finally {
    clearTimeout(timer);
  }
}

type ClaimStep =
  | { kind: "items"; claimed: FeedbackClaimResponse }
  | { kind: "empty"; claimed: FeedbackClaimResponse }
  | { kind: "gone" }
  | { kind: "retry" };

/** One claim, with the failure policy: only a settled connection is patient. */
async function claimOnce(
  context: Context,
  options: WaitOptions,
  state: { first: boolean; failures: number },
): Promise<ClaimStep> {
  // Events before this point are covered by this claim; later ones re-wake.
  context.wake.reset();
  try {
    const claimed = await context.deps.claim(context.signal);
    state.first = false;
    state.failures = 0;
    return { kind: claimed.items.length > 0 ? "items" : "empty", claimed };
  } catch (error) {
    if (context.signal.aborted || !(error instanceof ArtifactsCliError))
      throw error;
    if (options.notFoundIsGone === true && error.kind === "not-found")
      return { kind: "gone" };
    // Unreachable at the very start is a setup problem, not a blip.
    if (state.first || !error.transient) throw error;
    await sleep(
      backoffDelay(state.failures++, context.backoff, context.random),
      context.signal,
    );
    return { kind: "retry" };
  }
}

/** Print first, acknowledge after: a crash in between redelivers, never loses. */
async function deliver(
  deps: WaitDeps,
  items: FeedbackItem[],
  options: WaitOptions,
): Promise<WaitResult> {
  await deps.present(items);
  const ackError = await ackWithRetry(deps, items, options);
  return {
    outcome: "feedback",
    items,
    ...(ackError === null ? {} : { ackError }),
  };
}

async function claimLoop(
  context: Context,
  options: WaitOptions,
): Promise<WaitResult> {
  const state = { first: true, failures: 0 };
  for (;;) {
    if (context.fatal !== null) throw context.fatal;
    if (context.gone) return { outcome: "gone" };
    const step = await claimOnce(context, options, state);
    if (step.kind === "gone") return { outcome: "gone" };
    if (step.kind === "retry") continue;
    if (step.kind === "items")
      return deliver(context.deps, step.claimed.items, options);
    const settles = step.claimed.nextDeliverableAt;
    const untilSettled =
      settles === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(settles) - Date.now() + SETTLE_MARGIN_MS;
    await context.wake.waitUntil(
      Math.max(MIN_SLEEP_MS, Math.min(options.pollMs ?? 60_000, untilSettled)),
      context.signal,
    );
  }
}
