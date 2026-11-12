import { afterEach, expect, test, vi } from "vitest";
import {
  gitSpiceMergeArgs,
  landPr,
  MERGE_GRAPHQL_RESERVE,
  mergeQuota,
  type LandOptions,
} from "#commands/pr/land.ts";
import type { waitForPr } from "#commands/ci.ts";
import { GitHubClient } from "#lib/ci/github.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import type { WaitResult } from "#lib/ci/wait/wait.ts";
import { ciFixture, CI_HEAD } from "./ci/fixtures.ts";

const MERGE_SHA = "c".repeat(40);
const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "test",
  repoId: 1,
};
const options: LandOptions = { json: true, allowRedMain: false };

function ready(): WaitResult {
  return {
    snapshot: ciFixture(),
    verdict: { outcome: "ready", reasons: [], commands: [] },
    elapsedMs: 1,
  };
}

/** GitHub serves the PR; it reads as merged once `merged.value` is set. */
function stubPr(merged: { value: boolean }, headSha = CI_HEAD): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (!url.pathname.endsWith("/pulls/99"))
        throw new Error(`Unexpected request ${url.pathname}`);
      const pr = ciFixture().pr;
      return Response.json({
        ...pr,
        merged: merged.value,
        state: merged.value ? "closed" : "open",
        merge_commit_sha: merged.value ? MERGE_SHA : null,
        head: { sha: headSha, ref: "feature" },
      });
    }),
  );
}

const observer = () => new CiObserver(new GitHubClient("test"), config);
/** The GraphQL bucket can always afford a merge. */
const noQuota = async () => null;
afterEach(() => vi.unstubAllGlobals());

test("a ready PR is merged by branch and confirmed against GitHub", async () => {
  const merged = { value: false };
  stubPr(merged);
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  const merge = vi.fn(async (branch: string) => {
    expect(branch).toBe("feature");
    merged.value = true;
    return 0;
  });
  const { result, mergeCommitSha } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    { wait, merge, quota: noQuota },
  );
  expect(result.verdict.outcome).toBe("merged");
  expect(mergeCommitSha).toBe(MERGE_SHA);
  expect(result.verdict.commands).toEqual([
    `toolkit ci wait --main --head ${MERGE_SHA}`,
  ]);
  expect(wait.mock.calls[0]?.[2]).toMatchObject({ mainPolicy: "require" });
});

test("--allow-red-main waits with the ignore policy", async () => {
  stubPr({ value: false });
  const wait = vi.fn<typeof waitForPr>(async () => ({
    ...ready(),
    verdict: { outcome: "failure" as const, reasons: [], commands: [] },
  }));
  await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    { ...options, allowRedMain: true },
    { wait, merge: vi.fn(), quota: noQuota },
  );
  expect(wait.mock.calls[0]?.[2]).toMatchObject({ mainPolicy: "ignore" });
});

test("any non-ready wait outcome is returned without merging", async () => {
  for (const outcome of [
    "failure",
    "human_action",
    "head_changed",
    "timeout",
    "pr_closed",
  ] as const) {
    const merge = vi.fn();
    const { result } = await landPr(
      {
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
      },
      options,
      {
        wait: async () => ({
          ...ready(),
          verdict: { outcome, reasons: [], commands: [] },
        }),
        merge,
        quota: noQuota,
      },
    );
    expect(result.verdict.outcome).toBe(outcome);
    expect(merge).not.toHaveBeenCalled();
  }
});

test("a head that moves after readiness is not merged", async () => {
  stubPr({ value: false }, "d".repeat(40));
  const merge = vi.fn();
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    { wait: async () => ready(), merge, quota: noQuota },
  );
  expect(result.verdict.outcome).toBe("head_changed");
  expect(merge).not.toHaveBeenCalled();
});

test("a failed or unconfirmed merge reports merge_failed", async () => {
  for (const code of [1, 0]) {
    stubPr({ value: false });
    const { result, mergeCommitSha } = await landPr(
      {
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
      },
      options,
      { wait: async () => ready(), merge: async () => code, quota: noQuota },
    );
    expect(result.verdict.outcome).toBe("merge_failed");
    expect(result.verdict.reasons.join(" ")).toContain(
      `exited ${String(code)}`,
    );
    expect(mergeCommitSha).toBeNull();
  }
});

test("the merge squashes exactly the ready branch and checks GitHub once", () => {
  expect(gitSpiceMergeArgs("feature")).toEqual([
    "branch",
    "merge",
    "--method",
    "squash",
    "--ready-timeout",
    "0",
    "--branch",
    "feature",
  ]);
});

test("a cancelled merge reports the cancellation, not a merge result", async () => {
  stubPr({ value: false });
  const controller = new AbortController();
  const merge = vi.fn(async (_branch: string, signal: AbortSignal) => {
    controller.abort();
    expect(signal.aborted).toBe(true);
    return 143;
  });
  await expect(
    landPr(
      { number: 99, observer: observer(), signal: controller.signal },
      options,
      { wait: async () => ready(), merge, quota: noQuota },
    ),
  ).rejects.toThrow();
  expect(merge).toHaveBeenCalledWith("feature", controller.signal);
});

test("a bucket too low for a merge waits for the reset and proves readiness again", async () => {
  const merged = { value: false };
  stubPr(merged);
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  const quota = vi
    .fn<(signal: AbortSignal, fresh: boolean) => Promise<number | null>>()
    .mockResolvedValueOnce(1000)
    .mockResolvedValue(null);
  const pause =
    vi.fn<(resumeAt: number, signal: AbortSignal) => Promise<void>>();
  const merge = vi.fn(async () => {
    merged.value = true;
    return 0;
  });
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    { wait, merge, quota, pause },
  );
  expect(result.verdict.outcome).toBe("merged");
  expect(pause).toHaveBeenCalledWith(1000, expect.any(AbortSignal), null);
  expect(wait).toHaveBeenCalledTimes(2);
  // The second wait stays pinned to the head proven ready the first time.
  expect(wait.mock.calls[1]?.[2]).toMatchObject({ head: CI_HEAD });
  expect(merge).toHaveBeenCalledTimes(1);
  expect(quota.mock.calls.map(([, fresh]) => fresh)).toEqual([false, false]);
});

test("a merge refused on quota is retried once after the reset", async () => {
  const merged = { value: false };
  stubPr(merged);
  const pause =
    vi.fn<(resumeAt: number, signal: AbortSignal) => Promise<void>>();
  let attempts = 0;
  const merge = vi.fn(async () => {
    attempts++;
    if (attempts === 2) merged.value = true;
    return attempts === 2 ? 0 : 1;
  });
  const quota = vi.fn(async (_signal: AbortSignal, fresh: boolean) =>
    fresh ? 2000 : null,
  );
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    { wait: async () => ready(), merge, quota, pause },
  );
  expect(result.verdict.outcome).toBe("merged");
  expect(merge).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledWith(2000, expect.any(AbortSignal), null);
});

test("a second quota-refused merge reports merge_failed instead of retrying again", async () => {
  stubPr({ value: false });
  const merge = vi.fn(async () => 1);
  const pause =
    vi.fn<(resumeAt: number, signal: AbortSignal) => Promise<void>>();
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    {
      wait: async () => ready(),
      merge,
      quota: async (_signal, fresh) => (fresh ? 2000 : null),
      pause,
    },
  );
  expect(result.verdict.outcome).toBe("merge_failed");
  expect(merge).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledTimes(1);
});

test("a quota wait past the deadline reports timeout without merging", async () => {
  stubPr({ value: false });
  const merge = vi.fn();
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    { ...options, timeoutMs: 60_000 },
    {
      wait: async () => ready(),
      merge,
      quota: async () => Date.now() + 3_600_000,
      pause: vi.fn<(resumeAt: number, signal: AbortSignal) => Promise<void>>(),
    },
  );
  expect(result.verdict.outcome).toBe("timeout");
  expect(merge).not.toHaveBeenCalled();
});

test("the quota pause is bounded by the land deadline", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  stubPr({ value: false });
  const merge = vi.fn();
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  const pause = vi.fn(
    async (
      _resumeAt: number,
      _signal: AbortSignal,
      deadline: number | null,
    ) => {
      // The deadline arrives while paused; land must not wait for the jitter.
      expect(deadline).not.toBeNull();
      vi.setSystemTime((deadline ?? 0) + 1);
      await Promise.resolve();
    },
  );
  const { result } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    { ...options, timeoutMs: 60_000 },
    { wait, merge, quota: async () => Date.now() + 30_000, pause },
  );
  vi.useRealTimers();
  expect(result.verdict.outcome).toBe("timeout");
  expect(pause).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledTimes(1);
  expect(merge).not.toHaveBeenCalled();
});

function graphqlResponse(body: unknown, headers: Record<string, string>) {
  return Response.json(body, { headers });
}

test("merge quota reads the GraphQL bucket and treats a RATE_LIMIT refusal as a reset", async () => {
  const reset = Math.floor(Date.now() / 1000) + 600;
  const limitHeaders = (remaining: number) => ({
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-used": String(5000 - remaining),
    "x-ratelimit-reset": String(reset),
  });
  const respond = vi.fn();
  vi.stubGlobal("fetch", respond);
  const github = new GitHubClient("test");
  const signal = new AbortController().signal;

  respond.mockResolvedValueOnce(
    graphqlResponse(
      {
        data: {
          rateLimit: {
            limit: 5000,
            remaining: 4000,
            used: 1000,
            resetAt: new Date(reset * 1000).toISOString(),
          },
        },
      },
      limitHeaders(4000),
    ),
  );
  expect(await mergeQuota(github, signal, true)).toBeNull();

  respond.mockResolvedValueOnce(
    graphqlResponse(
      {
        data: {
          rateLimit: {
            limit: 5000,
            remaining: MERGE_GRAPHQL_RESERVE - 1,
            used: 5000 - MERGE_GRAPHQL_RESERVE + 1,
            resetAt: new Date(reset * 1000).toISOString(),
          },
        },
      },
      limitHeaders(MERGE_GRAPHQL_RESERVE - 1),
    ),
  );
  expect(await mergeQuota(github, signal, true)).toBe(reset * 1000);

  respond.mockResolvedValueOnce(
    graphqlResponse(
      {
        errors: [
          {
            type: "RATE_LIMIT",
            code: "graphql_rate_limit",
            message: "API rate limit already exceeded for user ID 3904778.",
          },
        ],
      },
      limitHeaders(0),
    ),
  );
  expect(await mergeQuota(github, signal, true)).toBe(reset * 1000);
  // A recent observation answers without another request.
  expect(await mergeQuota(github, signal, false)).toBe(reset * 1000);
  expect(respond).toHaveBeenCalledTimes(3);
});
