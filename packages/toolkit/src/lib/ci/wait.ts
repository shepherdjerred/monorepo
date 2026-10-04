import { evaluateReadiness, type Snapshot, type Verdict } from "./readiness.ts";

export type WaitDependencies = {
  snapshot: (signal: AbortSignal, force: boolean) => Promise<Snapshot>;
  subscribe: (
    signal: AbortSignal,
    wake: () => void,
    connected: () => void,
    fatal: (error: unknown) => void,
  ) => Promise<void>;
  heartbeat: (snapshot: Snapshot | null) => void;
};
export type WaitOptions = {
  head: string;
  until: "first-failure" | "settled";
  timeoutMs?: number;
  signal?: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
};
export type WaitResult = {
  snapshot: Snapshot | null;
  verdict: Verdict;
  elapsedMs: number;
};

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

type WaitContext = {
  options: WaitOptions;
  dependencies: WaitDependencies;
  signal: AbortSignal;
  updates: ReturnType<typeof notifier>;
  started: number;
  snapshot: Snapshot | null;
  streamError: Error | null;
};

function assertStream(context: WaitContext): void {
  if (context.streamError !== null) throw context.streamError;
}

async function candidate(
  context: WaitContext,
  snapshot: Snapshot,
): Promise<{ snapshot: Snapshot; verdict: Verdict }> {
  const verdict = evaluateReadiness(
    snapshot,
    context.options.head,
    context.options.until,
  );
  if (verdict.outcome !== "ready") return { snapshot, verdict };
  const final = await context.dependencies.snapshot(context.signal, true);
  const checked = evaluateReadiness(
    final,
    context.options.head,
    context.options.until,
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

async function runLoop(context: WaitContext): Promise<WaitResult> {
  let heartbeatAt = context.started;
  for (;;) {
    context.signal.throwIfAborted();
    assertStream(context);
    const current = await context.dependencies.snapshot(context.signal, false);
    const result = await candidate(context, current);
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

async function subscribe(
  context: WaitContext,
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
export async function waitForCi(
  options: WaitOptions,
  dependencies: WaitDependencies,
): Promise<WaitResult> {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, options.signal]);
  const context: WaitContext = {
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
    return {
      snapshot: context.snapshot,
      verdict: {
        outcome: "timeout",
        reasons: [
          "The requested wait deadline elapsed. This does not mean CI failed.",
        ],
        commands: ["toolkit ci load"],
      },
      elapsedMs: Date.now() - context.started,
    };
  } finally {
    if (deadline !== null) clearTimeout(deadline);
    clearTimeout(connectTimer);
    signal.removeEventListener("abort", abortConnection);
    controller.abort();
    await subscription;
  }
}
