import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createGitSpiceMerge,
  gitSpiceMergeArgs,
  landPr,
  MERGE_GRAPHQL_RESERVE,
  mergeQuota,
  type LandOptions,
} from "#commands/pr/land.ts";
import type { waitForPr } from "#commands/ci.ts";
import { GitHubClient } from "#lib/ci/github.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { EXIT_CODES } from "#lib/ci/readiness.ts";
import { PrLandReceiptSchema } from "#lib/ci/stale-base/receipts.ts";
import type { WaitResult } from "#lib/ci/wait/wait.ts";
import { ciFixture, CI_HEAD } from "./ci/fixtures.ts";

const MERGE_SHA = "c".repeat(40);
const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "test",
  repoId: 1,
};
const options: LandOptions = { json: true, allowRedMain: false };

let isolatedStateDir = "";
beforeEach(async () => {
  isolatedStateDir = await mkdtemp(path.join(tmpdir(), "toolkit-land-state-"));
  vi.stubEnv("TOOLKIT_STATE_DIR", isolatedStateDir);
});

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
      if (url.pathname.includes("/compare/")) {
        return Response.json({
          status: "identical",
          ahead_by: 0,
          behind_by: 0,
          total_commits: 0,
          base_commit: { sha: headSha },
          merge_base_commit: { sha: headSha },
          commits: [],
          files: [],
        });
      }
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
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (isolatedStateDir !== "") {
    await rm(isolatedStateDir, { recursive: true, force: true });
    isolatedStateDir = "";
  }
});

function landPr99(deps: Parameters<typeof landPr>[2], opts = options) {
  return landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    opts,
    deps,
  );
}

test("a ready PR is merged by branch and confirmed against GitHub", async () => {
  const merged = { value: false };
  stubPr(merged);
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  const merge = vi.fn(async (branch: string) => {
    expect(branch).toBe("feature");
    merged.value = true;
    return 0;
  });
  const { result, mergeCommitSha } = await landPr99({
    wait,
    merge,
    quota: noQuota,
  });
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

test("the merge squashes the ready branch without prompting and checks GitHub once", () => {
  expect(gitSpiceMergeArgs("feature")).toEqual([
    "branch",
    "merge",
    "--method",
    "squash",
    "--ready-timeout",
    "0",
    "--no-prompt",
    "--branch",
    "feature",
  ]);
});

test("a post-merge local trunk sync failure still reports merged when GitHub merged the PR", async () => {
  const merged = { value: false };
  stubPr(merged);
  const errorSpy = vi.spyOn(console, "error").mockReturnValue();
  const { result, mergeCommitSha } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    {
      wait: async () => ready(),
      merge: async () => {
        merged.value = true;
        return {
          code: 1,
          stderr:
            "merge queue barrier: sync trunk: stash changes: stash create: exit status 1",
        };
      },
      quota: noQuota,
    },
  );
  expect(result.verdict.outcome).toBe("merged");
  expect(mergeCommitSha).toBe(MERGE_SHA);
  expect(result.verdict.commands).toEqual([
    `toolkit ci wait --main --head ${MERGE_SHA}`,
  ]);
  expect(result.verdict.reasons).toEqual([
    `Merged PR #99 as ${MERGE_SHA}.`,
    "git-spice branch merge exited 1 during post-merge local trunk sync after GitHub merged PR #99.",
  ]);
  expect(errorSpy).toHaveBeenCalledWith(
    "git-spice branch merge exited 1 during post-merge local trunk sync after GitHub merged PR #99.",
  );
  errorSpy.mockRestore();
});

test("transient git-spice transport failures re-check readiness and retry up to twice", async () => {
  const merged = { value: false };
  stubPr(merged);
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  let attempts = 0;
  const merge = vi.fn(async () => {
    attempts += 1;
    if (attempts < 3) {
      return {
        code: 1,
        stderr:
          'FTL git-spice: Post "https://api.github.com/graphql": read tcp 10.0.0.1:443: connection reset by peer',
      };
    }
    merged.value = true;
    return { code: 0, stderr: "" };
  });
  const { result, mergeCommitSha } = await landPr99({
    wait,
    merge,
    quota: noQuota,
  });
  expect(result.verdict.outcome).toBe("merged");
  expect(mergeCommitSha).toBe(MERGE_SHA);
  expect(wait).toHaveBeenCalledTimes(3);
  expect(merge).toHaveBeenCalledTimes(3);
});

test("persistent git-spice transport failures stop after 2 retries and report merge_failed", async () => {
  stubPr({ value: false });
  const wait = vi.fn<typeof waitForPr>(async () => ready());
  const merge = vi.fn(async () => ({
    code: 1,
    stderr: "TLS handshake timeout",
  }));
  const { result, mergeCommitSha } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    { wait, merge, quota: noQuota },
  );
  expect(result.verdict.outcome).toBe("merge_failed");
  expect(mergeCommitSha).toBeNull();
  expect(wait).toHaveBeenCalledTimes(3);
  expect(merge).toHaveBeenCalledTimes(3);
});

test("createGitSpiceMerge closes stdin, passes GH_TOKEN, and captures stderr while teeing to stderr", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "toolkit-pr-land-"));
  try {
    const binPath = path.join(dir, "git-spice");
    await Bun.write(
      binPath,
      [
        "#!/bin/sh",
        'stdin_data="$(cat)"',
        'echo "args:$* token:${GH_TOKEN:-missing} stdin:${stdin_data}"',
        'echo "simulated ECONNRESET on graphql" >&2',
        "exit 1",
      ].join("\n"),
    );
    await chmod(binPath, 0o755);
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        writes.push(
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
        );
        return true;
      });
    try {
      const merger = createGitSpiceMerge({
        PATH: `${dir}:/bin:/usr/bin`,
        GH_TOKEN: "resolved-gh-token",
      });
      const outcome = await merger("feature", new AbortController().signal);
      expect(outcome).toEqual({
        code: 1,
        stderr: "simulated ECONNRESET on graphql\n",
      });
      const teed = writes.join("");
      expect(teed).toContain("--no-prompt");
      expect(teed).toContain("token:resolved-gh-token");
      expect(teed).toContain("stdin:\n");
      expect(teed).toContain("simulated ECONNRESET on graphql");
    } finally {
      writeSpy.mockRestore();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("blocks stale overlapping base with outcome failure (exit 1), restack commands, and NDJSON receipt", async () => {
  stubPr({ value: false });
  const merge = vi.fn();
  const baseSha = "e".repeat(40);
  const mainSha = "f".repeat(40);
  const { result, mergeCommitSha } = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    {
      wait: async () => ready(),
      merge,
      quota: noQuota,
      staleBase: async () => ({
        stale: true,
        headSha: CI_HEAD,
        mergeBaseSha: baseSha,
        mainHeadSha: mainSha,
        behindBy: 3,
        verdict: "stale_overlap",
        reasons: [
          "workspace dependency overlap with main advances: @shepherdjerred/tracker",
        ],
      }),
    },
  );
  expect(result.verdict.outcome).toBe("failure");
  expect(EXIT_CODES[result.verdict.outcome]).toBe(1);
  expect(mergeCommitSha).toBeNull();
  expect(merge).not.toHaveBeenCalled();
  expect(result.verdict.commands).toEqual([
    "toolkit git-spice repo sync --restack=aboves",
    "toolkit git-spice branch submit --update-only --no-web --no-prompt",
  ]);
  expect(result.verdict.reasons.join("\n")).toContain(
    "@shepherdjerred/tracker",
  );

  const rawLines = await Bun.file(
    path.join(isolatedStateDir, "pr-land.ndjson"),
  ).text();
  const lines = rawLines.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(PrLandReceiptSchema.parse(JSON.parse(lines[0] ?? ""))).toMatchObject({
    pr: 99,
    headSha: CI_HEAD,
    mergeBaseSha: baseSha,
    mainHeadSha: mainSha,
    behindBy: 3,
    verdict: "stale_overlap",
    bypassed: false,
  });
});

test("allows disjoint behind-main PRs and --allow-stale-base bypasses while recording receipts", async () => {
  const merged = { value: false };
  stubPr(merged);
  const baseSha = "e".repeat(40);
  const mainSha = "f".repeat(40);
  const merge = vi.fn(async () => {
    merged.value = true;
    return 0;
  });

  const disjointOutcome = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    options,
    {
      wait: async () => ready(),
      merge,
      quota: noQuota,
      staleBase: async () => ({
        stale: false,
        headSha: CI_HEAD,
        mergeBaseSha: baseSha,
        mainHeadSha: mainSha,
        behindBy: 2,
        verdict: "disjoint_clean",
        reasons: [],
      }),
    },
  );
  expect(disjointOutcome.result.verdict.outcome).toBe("merged");

  merged.value = false;
  stubPr(merged);
  const bypassedOutcome = await landPr(
    { number: 99, observer: observer(), signal: new AbortController().signal },
    { ...options, allowStaleBase: true },
    {
      wait: async () => ready(),
      merge,
      quota: noQuota,
      staleBase: async () => ({
        stale: true,
        headSha: CI_HEAD,
        mergeBaseSha: baseSha,
        mainHeadSha: mainSha,
        behindBy: 5,
        verdict: "stale_overlap",
        reasons: ["main modified global verification input(s): bun.lock"],
      }),
    },
  );
  expect(bypassedOutcome.result.verdict.outcome).toBe("merged");

  const rawReceipts = await Bun.file(
    path.join(isolatedStateDir, "pr-land.ndjson"),
  ).text();
  const receipts = rawReceipts
    .trim()
    .split("\n")
    .map((line) => PrLandReceiptSchema.parse(JSON.parse(line)));
  expect(receipts).toHaveLength(2);
  expect(receipts[0]).toMatchObject({
    verdict: "disjoint_clean",
    bypassed: false,
  });
  expect(receipts[1]).toMatchObject({
    verdict: "stale_overlap",
    bypassed: true,
  });
});
