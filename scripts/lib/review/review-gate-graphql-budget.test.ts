/**
 * The review gate's GraphQL cost at fleet scale.
 *
 * Thirty pull requests waiting on review at once, each polled every 30s for a
 * full hour against an in-memory GitHub that honors REST ETags. Every GraphQL
 * listing query here costs one point (100 threads x 1 comment, or 100
 * reviews), which is GitHub's minimum, so counting queries counts points.
 *
 * The budget: thirty gates may spend at most half of the App installation's
 * 5,000-point hourly GraphQL bucket.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { coderabbitProvider, codexProvider } from "@shepherdjerred/code-review";
import { ReviewListingCache } from "@shepherdjerred/code-review/github-review-listing-cache";
import type { ReviewListing } from "@shepherdjerred/code-review/github-review-snapshot";
import type { GatePollState } from "./review-gate-observe.ts";
import {
  pollOnce,
  ReviewGateFailure,
  type PollLoopConfig,
  type PollLoopState,
} from "./review-gate-poll.ts";

const GATES = 30;
const INTERVAL_SECONDS = 30;
const TICKS_PER_HOUR = (60 * 60) / INTERVAL_SECONDS;
const APP_GRAPHQL_BUCKET = 5000;

type FakePullRequest = {
  head: string;
  /** REST review records, as GitHub returns them. */
  reviews: Record<string, unknown>[];
  issueComments: { body: string; created_at: string }[];
};

const GraphqlBodySchema = z.object({
  query: z.string(),
  variables: z.object({ number: z.number() }),
});
const CommentBodySchema = z.object({ body: z.string() });

function etagOf(body: string): string {
  return `"${String(Bun.hash(body))}"`;
}

function requestBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : null;
}

/** The listing pages for one pull request: no threads, no provider reviews. */
function graphqlAnswer(
  pulls: Map<number, FakePullRequest>,
  init: RequestInit | undefined,
): Response {
  const { query, variables } = GraphqlBodySchema.parse(requestBody(init));
  const page = { pageInfo: { hasNextPage: false, endCursor: null } };
  const pullRequest = query.includes("reviewThreads(")
    ? {
        headRefOid: pulls.get(variables.number)?.head,
        reviewThreads: { ...page, nodes: [] },
      }
    : { reviews: { ...page, nodes: [] } };
  return Response.json({ data: { repository: { pullRequest } } });
}

function restPayload(path: string, pull: FakePullRequest | undefined): unknown {
  if (/\/pulls\/\d+$/u.test(path)) {
    return {
      user: { login: "shepherdjerred", type: "User" },
      head: { sha: pull?.head },
    };
  }
  if (path.endsWith("/reviews")) return pull?.reviews ?? [];
  if (path.endsWith("/comments") && path.includes("/issues/")) {
    return pull?.issueComments ?? [];
  }
  return path.endsWith("/check-runs") ? { total_count: 0, check_runs: [] } : [];
}

/** A REST answer with a content ETag that revalidates to an uncharged 304. */
function restAnswer(payload: unknown, init: RequestInit | undefined): Response {
  const body = JSON.stringify(payload);
  const etag = etagOf(body);
  if (new Headers(init?.headers).get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return new Response(body, {
    status: 200,
    headers: { etag, "content-type": "application/json" },
  });
}

/** An in-memory GitHub that counts every GraphQL query. */
function fakeGitHub(pulls: Map<number, FakePullRequest>) {
  const counts = { graphql: 0 };
  const fetchStub = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input));
    if (url.pathname === "/graphql") {
      counts.graphql++;
      return graphqlAnswer(pulls, init);
    }
    const number = Number(/\/(?:pulls|issues)\/(\d+)/u.exec(url.pathname)?.[1]);
    const pull = pulls.get(number);
    if (init?.method === "POST") {
      pull?.issueComments.push({
        body: CommentBodySchema.parse(requestBody(init)).body,
        created_at: new Date().toISOString(),
      });
      return Response.json({ id: 1 }, { status: 201 });
    }
    return restAnswer(restPayload(url.pathname, pull), init);
  });
  return { counts, fetchStub };
}

function config(number: number, head: string): PollLoopConfig {
  return {
    providers: [codexProvider, coderabbitProvider],
    repo: "shepherdjerred/monorepo",
    number,
    head,
    readToken: async () => `token-${String(number)}`,
    requestToken: "request-token",
    policy: {
      alwaysBlockingPriority: 1,
      maxBlockingPriority: 3,
      lowSeverity: "first-review-or-accompanied",
    },
    configuredGraceSeconds: 600,
    retryAfterSeconds: 900,
    timeoutSeconds: 3600,
    intervalSeconds: INTERVAL_SECONDS,
  };
}

/**
 * Run `GATES` gates for an hour and return the GraphQL points spent.
 * `busyEveryTicks` adds an unrelated review that often, so the change signal
 * moves and forces re-lists the way a live pull request does.
 */
async function simulateHour(input: {
  listings: () => ReviewListingCache;
  firstPr: number;
  busyEveryTicks?: number;
}): Promise<number> {
  const pulls = new Map<number, FakePullRequest>();
  const gates: {
    config: PollLoopConfig;
    poll: GatePollState;
    state: PollLoopState;
  }[] = [];
  const startedAt = Date.now();
  for (let index = 0; index < GATES; index++) {
    const number = input.firstPr + index;
    const head = number.toString(16).padStart(40, "0");
    pulls.set(number, { head, reviews: [], issueComments: [] });
    gates.push({
      config: config(number, head),
      poll: {
        // The push time resolves once per run, identically before and after.
        headPushedAt: new Date(startedAt).toISOString(),
        pullRequestAuthor: null,
        attempts: new Map([
          [codexProvider.id, 1],
          [coderabbitProvider.id, 1],
        ]),
        listings: input.listings(),
        lastObservations: new Map(),
        warnedMismatch: false,
        warnedOversized: new Set(),
      },
      state: { passStreak: 0, lastPollError: null },
    });
  }
  const github = fakeGitHub(pulls);
  vi.stubGlobal("fetch", github.fetchStub);
  for (let tick = 0; tick < TICKS_PER_HOUR; tick++) {
    for (const gate of gates) {
      if (
        input.busyEveryTicks !== undefined &&
        tick % input.busyEveryTicks === 0
      ) {
        pulls.get(gate.config.number)?.reviews.push({
          id: tick,
          body: "an unrelated reviewer",
        });
      }
      expect(
        await pollOnce(gate.config, gate.poll, startedAt, gate.state),
      ).toBe(false);
    }
    vi.advanceTimersByTime(INTERVAL_SECONDS * 1000);
  }
  for (const gate of gates) {
    // Every poll observed the providers; none was swallowed as transient.
    expect(gate.state.lastPollError).toBeNull();
    expect(gate.poll.lastObservations.size).toBe(2);
  }
  return github.counts.graphql;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T00:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(vi.fn());
  vi.spyOn(console, "warn").mockImplementation(vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("thirty gates waiting an hour", () => {
  test("re-listing every poll, as the gate used to, spends ~3x the whole bucket", async () => {
    // maxAgeMs 0 reproduces the old gate: a fresh listing per provider per poll.
    const points = await simulateHour({
      listings: () => new ReviewListingCache({ maxAgeMs: 0 }),
      firstPr: 10_000,
    });
    expect(points).toBe(GATES * TICKS_PER_HOUR * 2 * 2);
    expect(points).toBeGreaterThan(APP_GRAPHQL_BUCKET * 2.8);
  });

  test("reusing unchanged listings fits in a tenth of the bucket", async () => {
    const points = await simulateHour({
      listings: () => new ReviewListingCache(),
      firstPr: 20_000,
    });
    // One listing at start, then one safety re-list every five minutes.
    expect(points).toBe(GATES * 12 * 2);
    expect(points).toBeLessThanOrEqual(APP_GRAPHQL_BUCKET / 2);
  });

  test("a pull request that changes every three and a half minutes still fits", async () => {
    const points = await simulateHour({
      listings: () => new ReviewListingCache(),
      firstPr: 30_000,
      busyEveryTicks: 7,
    });
    // Each change re-lists at once and restarts the five-minute clock.
    expect(points).toBe(GATES * 18 * 2);
    expect(points).toBeLessThanOrEqual(APP_GRAPHQL_BUCKET / 2);
  });
});

describe("a reused listing never decides a failure", () => {
  const head = "c".repeat(40);
  const number = 40_000;
  const codexLogin = "chatgpt-codex-connector";

  function listingWithThread(isResolved: boolean): ReviewListing {
    const review = { id: "review-1", submittedAt: "2026-11-12T00:00:10Z" };
    return {
      headRefOid: head,
      threadPayloads: [
        {
          data: {
            repository: {
              pullRequest: {
                headRefOid: head,
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "thread-1",
                      isResolved,
                      isOutdated: false,
                      path: "a.ts",
                      line: 1,
                      comments: {
                        nodes: [
                          {
                            author: { login: codexLogin },
                            url: "https://example.test/thread-1",
                            body: "![P1 Badge](https://example.test/p1.svg) Fix this",
                            pullRequestReview: review,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
      reviewPayloads: [
        {
          data: {
            repository: {
              pullRequest: {
                reviews: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      ...review,
                      state: "COMMENTED",
                      body: "### 💡 Codex Review",
                      commit: { oid: head },
                      author: { login: codexLogin },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    };
  }

  async function runTwoTicks(freshListingResolved: boolean) {
    const pull: FakePullRequest = { head, reviews: [], issueComments: [] };
    vi.stubGlobal("fetch", fakeGitHub(new Map([[number, pull]])).fetchStub);
    const fetchListing = vi
      .fn<() => Promise<ReviewListing>>()
      .mockResolvedValueOnce(listingWithThread(false))
      .mockResolvedValue(listingWithThread(freshListingResolved));
    const gate = {
      ...config(number, head),
      providers: [codexProvider],
    };
    const poll: GatePollState = {
      headPushedAt: "2026-11-12T00:00:00Z",
      pullRequestAuthor: null,
      attempts: new Map([[codexProvider.id, 1]]),
      // A signal that never moves: the worst case, a resolution no REST view
      // records.
      listings: new ReviewListingCache({
        fetch: fetchListing,
        signal: async () => "unchanged",
      }),
      lastObservations: new Map(),
      warnedMismatch: false,
      warnedOversized: new Set(),
    };
    const state: PollLoopState = { passStreak: 0, lastPollError: null };
    const startedAt = Date.now();
    // Tick 1: Codex has not reviewed yet, so the unresolved finding waits.
    await expect(pollOnce(gate, poll, startedAt, state)).resolves.toBe(false);
    // Tick 2: Codex's review lands; the held listing still shows the thread.
    pull.reviews.push({
      id: 1,
      body: "### 💡 Codex Review",
      user: { login: codexLogin },
      state: "COMMENTED",
      submitted_at: "2026-11-12T00:00:10Z",
      commit_id: head,
    });
    vi.advanceTimersByTime(INTERVAL_SECONDS * 1000);
    return { result: pollOnce(gate, poll, startedAt, state), fetchListing };
  }

  test("a thread resolved since the held listing does not fail the gate", async () => {
    const { result, fetchListing } = await runTwoTicks(true);
    await expect(result).resolves.toBe(false);
    expect(fetchListing).toHaveBeenCalledTimes(2);
  });

  test("a failure that the fresh listing confirms still fails", async () => {
    const { result, fetchListing } = await runTwoTicks(false);
    await expect(result).rejects.toBeInstanceOf(ReviewGateFailure);
    expect(fetchListing).toHaveBeenCalledTimes(2);
  });
});
