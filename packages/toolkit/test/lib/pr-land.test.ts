import { afterEach, expect, test, vi } from "vitest";
import {
  gitSpiceMergeArgs,
  landPr,
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
    { wait, merge },
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
    { wait, merge: vi.fn() },
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
    { wait: async () => ready(), merge },
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
      { wait: async () => ready(), merge: async () => code },
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
      { wait: async () => ready(), merge },
    ),
  ).rejects.toThrow();
  expect(merge).toHaveBeenCalledWith("feature", controller.signal);
});
