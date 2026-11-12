/**
 * A simulated hour of concurrent `toolkit ci wait` processes on one host.
 *
 * The fakes in `github-budget-fakes.ts` count GitHub GraphQL points and REST
 * requests and feed a Woodpecker SSE stream at a configured event rate; fake
 * timers run the hour in seconds. Each waiter is its own GitHubClient and
 * CiObserver, as separate processes are; `shared` gives them one store, as
 * toolkit processes on one host share `~/.cache/toolkit/github`. The shared
 * store is in memory here: real file I/O would let the fake clock run ahead
 * of reads. `DiskStore` semantics are covered by `github-budget.test.ts`.
 */

import { vi } from "vitest";
import { waitForPr } from "#commands/ci.ts";
import { GitHubClient, REPOSITORY } from "#lib/ci/github.ts";
import { MemoryStore } from "#lib/ci/github/budget.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import {
  FakeCi,
  seededRandom,
  WOODPECKER,
  type Counters,
  type Pr,
} from "./github-budget-fakes.ts";

const config = { baseUrl: WOODPECKER, token: "woodpecker-test", repoId: 1 };
const START = Date.UTC(2026, 10, 12, 0, 0, 0);

export type SimulationOptions = {
  waiters: number;
  minutes: number;
  eventsPerMinute: number;
  mainEventsPerMinute: number;
  /** Give every waiter one shared store (the machine-wide cache). */
  shared: boolean;
  seed: number;
  /**
   * Bucket size the fake GitHub reports. The default is GitHub's 5,000; a
   * baseline measurement of unthrottled demand passes a larger one so older
   * code is not refused part-way.
   */
  bucketLimit?: number;
};

export type SimulationResult = Counters & {
  waits: number;
  outcomes: Record<string, number>;
  /** From a PR pipeline's success to its waiter reporting ready. */
  readyLatencyMs: number[];
};

type Run = {
  fake: FakeCi;
  result: SimulationResult;
  stop: AbortSignal;
  store: MemoryStore | null;
};

/** A pause between processes that ends when the simulation does. */
function pause(ms: number, stop: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    stop.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** One wait process; null when the simulation ended it. */
async function waitOnce(
  run: Run,
  pr: Pr,
  index: number,
): Promise<string | null> {
  const client =
    run.store === null
      ? new GitHubClient(`token-${String(index)}`)
      : new GitHubClient("one-account-token", REPOSITORY, { store: run.store });
  run.result.waits++;
  try {
    const wait = await waitForPr(
      pr.number,
      new CiObserver(client, config),
      { until: "first-failure", mainPolicy: "report" },
      run.stop,
    );
    const finished = pr.pipelines[0]?.finishedAt ?? null;
    if (finished !== null && wait.verdict.outcome === "ready")
      run.result.readyLatencyMs.push(Date.now() - finished);
    return wait.verdict.outcome;
  } catch (error) {
    if (run.stop.aborted) return null;
    throw error;
  }
}

/** An agent: wait on a PR; re-wait after a push; otherwise open the next PR. */
async function agent(run: Run, index: number): Promise<void> {
  // Stagger process start-up across the first minute.
  await pause(index * 2000, run.stop);
  let pr = run.fake.openPr();
  while (!run.stop.aborted) {
    const outcome = await waitOnce(run, pr, index);
    if (outcome === null) return;
    run.result.outcomes[outcome] = (run.result.outcomes[outcome] ?? 0) + 1;
    if (outcome !== "head_changed") {
      run.fake.prs.delete(pr.number);
      await pause(60_000, run.stop);
      pr = run.fake.openPr();
    }
  }
}

export async function simulate(
  options: SimulationOptions,
): Promise<SimulationResult> {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
    now: START,
  });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {
    // Wait progress lines are not under test here.
  });
  const fake = new FakeCi(
    seededRandom(options.seed),
    options.bucketLimit ?? 5000,
    options.mainEventsPerMinute / options.eventsPerMinute,
  );
  vi.stubGlobal("fetch", vi.fn(fake.fetch));
  const stop = new AbortController();
  const run: Run = {
    fake,
    result: { ...fake.counters, waits: 0, outcomes: {}, readyLatencyMs: [] },
    stop: stop.signal,
    store: options.shared ? new MemoryStore(100_000) : null,
  };
  fake.startMain();
  const mainTimer = setInterval(() => {
    fake.startMain();
  }, 10 * 60_000);
  const eventTimer = setInterval(fake.tick, 60_000 / options.eventsPerMinute);
  const agents = Array.from({ length: options.waiters }, (_, index) =>
    agent(run, index),
  );
  try {
    for (let second = 0; second < options.minutes * 60; second++)
      await vi.advanceTimersByTimeAsync(1000);
    clearInterval(mainTimer);
    clearInterval(eventTimer);
    stop.abort(new Error("simulation over"));
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(agents);
  } finally {
    clearInterval(mainTimer);
    clearInterval(eventTimer);
    errors.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
  return { ...run.result, ...fake.counters };
}
