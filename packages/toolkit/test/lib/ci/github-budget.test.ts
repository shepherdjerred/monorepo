import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  BUDGET_FLOOR,
  DiskStore,
  nextPeriodicRead,
  RateLimitLedger,
  RESUME_SPREAD_MS,
  type RateLimitBucket,
} from "#lib/ci/github/budget.ts";
import { GitHubClient, REPOSITORY } from "#lib/ci/github.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { CI_BASE, CI_HEAD } from "./fixtures.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-gh-budget-"));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

const bucket = (
  remaining: number,
  resetAt: number,
  observedAt = 0,
): RateLimitBucket => ({
  resource: "graphql",
  limit: 5000,
  remaining,
  used: 5000 - remaining,
  resetAt,
  observedAt,
});

function increment(current: number | undefined): number {
  return current === undefined ? 1 : current + 1;
}

describe("shared store", () => {
  test("separate processes see each other's writes and leave no temporaries", async () => {
    const first = new DiskStore(directory);
    const second = new DiskStore(directory);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? first : second).write("pr:1", {
          etag: `e${String(index)}`,
        }),
      ),
    );
    await second.write("pr:1", { etag: "two" });
    const read = await first.read("pr:1", z.object({ etag: z.string() }));
    expect(read).toEqual({ etag: "two" });
    expect(await first.read("pr:2", z.unknown())).toBeUndefined();
    const names = await readdir(directory);
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("updates from two processes and parallel requests never lose a write", async () => {
    const first = new DiskStore(directory);
    const second = new DiskStore(directory);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? first : second).update(
          "count",
          z.number(),
          increment,
        ),
      ),
    );
    expect(await first.read("count", z.number())).toBe(40);
    const names = await readdir(directory);
    expect(names.some((name) => name.endsWith(".lock"))).toBe(false);
  });

  test("a lock left by a crashed process is broken", async () => {
    const store = new DiskStore(directory);
    await store.write("count", 1);
    const [file] = await readdir(directory);
    if (file === undefined) throw new Error("the entry was not written");
    const lock = path.join(directory, `${file}.lock`);
    await mkdir(lock);
    const stale = (Date.now() - 60_000) / 1000;
    await utimes(lock, stale, stale);
    await store.update("count", z.number(), increment);
    expect(await store.read("count", z.number())).toBe(2);
  });

  test("pruning removes only entries untouched for two days", async () => {
    const now = Date.now();
    const store = new DiskStore(directory, () => now);
    await store.write("old", 1);
    const [oldFile] = await readdir(directory);
    if (oldFile === undefined) throw new Error("the entry was not written");
    const stale = (now - 3 * 24 * 60 * 60_000) / 1000;
    await utimes(path.join(directory, oldFile), stale, stale);
    await store.write("new", 2);
    await store.prune();
    expect(await store.read("old", z.number())).toBeUndefined();
    expect(await store.read("new", z.number())).toBe(2);
  });

  test("a value that fails its schema is a contract failure, not a cache miss", async () => {
    const store = new DiskStore(directory);
    await store.write("key", 1);
    await expect(store.read("key", z.string())).rejects.toThrow();
  });
});

describe("rate-limit ledger", () => {
  test("concurrent observations of two resources both survive", async () => {
    const ledger = new RateLimitLedger(new DiskStore(directory));
    const later = Date.now() + 600_000;
    await Promise.all([
      ledger.record("me", { ...bucket(4000, later), resource: "core" }),
      ledger.record("me", bucket(3000, later)),
      ledger.record("me", bucket(3500, later)),
    ]);
    const core = await ledger.bucket("me", "core");
    const graphql = await ledger.bucket("me", "graphql");
    expect(core?.remaining).toBe(4000);
    expect(graphql?.remaining).toBe(3000);
  });

  test("keeps the lowest remaining within a window and replaces it after a reset", async () => {
    let now = 1000;
    const ledger = new RateLimitLedger(new DiskStore(directory), () => now);
    const remaining = async (identity = "me") => {
      const current = await ledger.bucket(identity, "graphql");
      return current?.remaining ?? null;
    };
    await ledger.record("me", bucket(4000, 10_000));
    await ledger.record("me", bucket(4500, 10_000)); // a slower writer
    expect(await remaining()).toBe(4000);
    await ledger.record("me", bucket(4990, 20_000));
    expect(await remaining()).toBe(4990);
    expect(await remaining("other")).toBeNull();
    now = 20_000;
    expect(await remaining()).toBeNull();
  });
});

describe("periodic read pacing", () => {
  test("runs at the base interval while half the bucket remains", () => {
    expect(nextPeriodicRead(0, [bucket(4000, 1e9), null], 60_000, 0.5)).toBe(
      60_000,
    );
  });
  test("stretches in proportion between half and the floor", () => {
    expect(nextPeriodicRead(0, [bucket(1250, 1e9)], 60_000, 0)).toBe(120_000);
  });
  test("below the floor waits for the reset plus this process's share of the spread", () => {
    const remaining = Math.floor(5000 * BUDGET_FLOOR) - 1;
    expect(nextPeriodicRead(0, [bucket(remaining, 600_000)], 60_000, 0.5)).toBe(
      600_000 + RESUME_SPREAD_MS / 2,
    );
  });
});

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "woodpecker",
  repoId: 1,
};

/** A fake GitHub and Woodpecker for one PR whose pipeline status is mutable. */
function world() {
  const state = {
    head: CI_HEAD,
    pipelineStatus: "running",
    remaining: 4900,
    graphql: 0,
    rest: 0,
    protection: 0,
  };
  const reset = String(Math.floor(Date.now() / 1000) + 1800);
  const limit = (resource: string) => ({
    "x-ratelimit-resource": resource,
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": String(state.remaining),
    "x-ratelimit-used": String(5000 - state.remaining),
    "x-ratelimit-reset": reset,
  });
  const etagged = (request: Request, body: unknown) => {
    const text = JSON.stringify(body);
    const etag = `"${createHash("sha256").update(text).digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers: limit("core") });
    state.rest++;
    return new Response(text, {
      headers: { etag, "content-type": "application/json", ...limit("core") },
    });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(String(input), init ?? {});
      const url = new URL(request.url);
      if (url.origin === config.baseUrl) {
        const pipeline = {
          number: 7,
          commit: state.head,
          status: state.pipelineStatus,
          event: "pull_request",
          ref: "refs/pull/99/head",
          branch: "feature",
          rerun_count: 0,
        };
        if (url.pathname.endsWith("/pipelines/7"))
          return Response.json({
            ...pipeline,
            workflows: [{ name: "ci-complete", state: state.pipelineStatus }],
          });
        return Response.json(
          url.searchParams.get("event") === "pull_request" ? [pipeline] : [],
        );
      }
      if (url.pathname === "/graphql") {
        state.graphql++;
        return Response.json(
          {
            data: {
              repository: {
                pullRequest: {
                  headRefOid: state.head,
                  baseRefOid: CI_BASE,
                  reviewDecision: null,
                },
              },
            },
          },
          { headers: limit("graphql") },
        );
      }
      if (url.pathname.endsWith("/pulls/99"))
        return etagged(request, {
          number: 99,
          html_url: "https://github.com/shepherdjerred/monorepo/pull/99",
          state: "open",
          merged: false,
          draft: false,
          mergeable: true,
          mergeable_state: "blocked",
          head: { sha: state.head },
          base: { sha: CI_BASE, ref: "main" },
        });
      if (url.pathname.endsWith("/protection")) {
        state.protection++;
        return new Response("{}", { status: 404, headers: limit("core") });
      }
      if (url.pathname.endsWith("/repos/shepherdjerred/monorepo/branches/main"))
        return etagged(request, { commit: { sha: CI_BASE } });
      return url.pathname.endsWith("/check-runs")
        ? etagged(request, { check_runs: [] })
        : etagged(request, []);
    }),
  );
  return state;
}

function observer(
  timing: Partial<ConstructorParameters<typeof CiObserver>[2]> = {},
) {
  return new CiObserver(
    new GitHubClient("token", REPOSITORY, { store: new DiskStore(directory) }),
    config,
    { resumeOffset: 0, ...timing },
  );
}

describe("observer GitHub reads", () => {
  test("Woodpecker-only snapshots reuse the GitHub half until the interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    const watcher = observer();
    const first = await watcher.snapshot(99);
    expect(first.githubFresh).toBe(false);
    const reads = state.rest;
    vi.advanceTimersByTime(30_000);
    await watcher.snapshot(99);
    expect(state.rest).toBe(reads);
    expect(watcher.githubReads).toBe(1);
    vi.advanceTimersByTime(30_000);
    await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(2);
    // The decision inputs did not change, so no second GraphQL point was spent.
    expect(state.graphql).toBe(1);
  });

  test("a pipeline status change reads GitHub once the minimum gap has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    const watcher = observer();
    await watcher.snapshot(99);
    state.pipelineStatus = "success";
    vi.advanceTimersByTime(5000);
    const first = await watcher.snapshot(99);
    expect(first.githubFresh).toBe(false);
    expect(watcher.githubReads).toBe(1);
    vi.advanceTimersByTime(6000);
    await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(2);
  });

  test("an event naming a new commit reads GitHub again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    const watcher = observer();
    await watcher.snapshot(99);
    vi.advanceTimersByTime(11_000);
    watcher.notePrCommit(99, CI_HEAD);
    await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(1);
    state.head = "c".repeat(40);
    watcher.notePrCommit(99, state.head);
    const pushed = await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(2);
    expect(pushed.pr.head.sha).toBe(state.head);
  });

  test("a forced read asks GitHub for every input, including the decision", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    const watcher = observer();
    await watcher.snapshot(99);
    const forced = await watcher.snapshot(99, undefined, true);
    expect(forced.githubFresh).toBe(true);
    expect(state.graphql).toBe(2);
    expect(state.protection).toBe(2);
  });

  test("processes on one host share rules and decisions", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    await observer().snapshot(99);
    await observer().snapshot(99);
    expect(state.graphql).toBe(1);
    // The un-ETagged protection 404 is charged per request, so it is shared too.
    expect(state.protection).toBe(1);
  });

  test("below the budget floor periodic reads wait for the reset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const state = world();
    state.remaining = 500;
    const watcher = observer();
    await watcher.snapshot(99);
    vi.advanceTimersByTime(10 * 60_000);
    await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(1);
    // A final read is never throttled.
    await watcher.snapshot(99, undefined, true);
    expect(watcher.githubReads).toBe(2);
    vi.advanceTimersByTime(25 * 60_000);
    await watcher.snapshot(99);
    expect(watcher.githubReads).toBe(3);
  });
});
