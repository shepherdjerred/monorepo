import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import {
  getFollowedMainSnapshot,
  getMainRun,
  getMainStatus,
  resolveMainHeadSha,
} from "#lib/ci/main.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import { CI_HEAD } from "./fixtures.ts";

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "test",
  repoId: 1,
};
const required = [
  "verify",
  "homelab-release-admission",
  "images",
  "helm-push",
  "argocd-sync",
];
function pipeline(
  number: number,
  event: string,
  status = "success",
): WoodpeckerPipeline {
  return {
    number,
    event,
    status,
    commit: CI_HEAD,
    branch: "main",
    ref: "refs/heads/main",
    finished: status === "running" ? 0 : number,
    workflows: required.map((name) => ({ name, state: status })),
  };
}
function failedPush(): WoodpeckerPipeline {
  return { ...pipeline(7, "push", "failure"), commit: "older-main" };
}
function mockApi(
  pages: WoodpeckerPipeline[][],
  details?: WoodpeckerPipeline,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/branches/main"))
        return Response.json({ commit: { sha: CI_HEAD } });
      const number = /\/pipelines\/(\d+)$/.exec(url.pathname)?.[1];
      if (number !== undefined) {
        const result =
          details?.number === Number(number)
            ? details
            : pages.flat().find((item) => item.number === Number(number));
        if (result === undefined)
          throw new Error(`Unexpected pipeline ${number}`);
        return Response.json(result);
      }
      expect(url.searchParams.get("event")).toBe("push,manual");
      expect(url.searchParams.get("branch")).toBe("main");
      return Response.json(
        pages[Number(url.searchParams.get("page")) - 1] ?? [],
      );
    }),
  );
}
const status = () => getMainStatus(new GitHubClient("test"), config);
afterEach(() => vi.unstubAllGlobals());

test("a full manual recovery at the current main head replaces its failed push verdict", async () => {
  mockApi([[pipeline(8, "manual"), failedPush()]]);
  const result = await status();
  expect(result.state).toBe("green");
  expect(result.latest?.number).toBe(8);
  expect(result.lastVerdict?.number).toBe(8);
});

test("an unfinished manual recovery preserves the failed completed verdict", async () => {
  mockApi([[pipeline(8, "manual", "running"), failedPush()]]);
  const result = await status();
  expect(result.state).toBe("red");
  expect(result.latest?.number).toBe(8);
  expect(result.lastVerdict?.number).toBe(7);
});

test("partial, skipped and inconsistent manual successes cannot clear a failure", async () => {
  const full = pipeline(8, "manual");
  for (const workflows of [
    [{ name: "ci-noop", state: "success" }],
    full.workflows.filter((workflow) => workflow.name !== "verify"),
    full.workflows.map((workflow) => ({
      ...workflow,
      state: workflow.name === "argocd-sync" ? "skipped" : "success",
    })),
    [...full.workflows, { name: "extra-check", state: "pending" }],
  ]) {
    mockApi([[{ ...full, workflows }, failedPush()]]);
    const result = await status();
    expect(result.state).toBe("red");
    expect(result.latest).toBeNull();
    expect(result.lastVerdict?.number).toBe(7);
  }
});

test("a later failed main push supersedes a successful manual recovery", async () => {
  mockApi([[pipeline(9, "push", "failure"), pipeline(8, "manual")]]);
  const result = await status();
  expect(result.state).toBe("red");
  expect(result.lastVerdict?.number).toBe(9);
});

test("an older-head manual success does not verify the current main commit", async () => {
  mockApi([[{ ...pipeline(8, "manual"), commit: "older-main" }, failedPush()]]);
  const result = await status();
  expect(result.state).toBe("pending");
  expect(result.latest).toBeNull();
  expect(result.lastVerdict?.number).toBe(8);
});

test("PR and feature-branch manual jobs cannot become main verdicts", async () => {
  mockApi([
    [
      { ...pipeline(10, "pull_request"), ref: "refs/pull/99/head" },
      {
        ...pipeline(9, "manual"),
        branch: "feature",
        ref: "refs/heads/feature",
      },
      failedPush(),
    ],
  ]);
  const result = await status();
  expect(result.state).toBe("red");
});

test("main pipeline details must preserve the listed revision, event and ref", async () => {
  const listed = pipeline(8, "manual");
  for (const changed of [
    { commit: "wrong" },
    { event: "pull_request" },
    { ref: "refs/pull/99/head" },
    { branch: "feature" },
    { number: 9 },
  ]) {
    const detail = { ...listed, ...changed };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        Response.json(
          url.pathname.endsWith("/branches/main")
            ? { commit: { sha: CI_HEAD } }
            : url.pathname.endsWith("/8")
              ? detail
              : [listed],
        ),
      ),
    );
    await expect(status()).rejects.toThrow(
      "number" in changed ? "wrong pipeline" : "does not match",
    );
  }
});

test("pagination reads past completed partial manual runs to find full recovery", async () => {
  const partial = Array.from({ length: 50 }, (_, index) => ({
    ...pipeline(150 - index, "manual"),
    workflows: [{ name: "ci-noop", state: "success" }],
  }));
  mockApi([partial, [pipeline(50, "manual"), failedPush()]]);
  const result = await status();
  expect(result.state).toBe("green");
  expect(result.lastVerdict?.number).toBe(50);
});

const pinned = (sha: string) =>
  getMainRun(new GitHubClient("test"), config, sha);

test("a pinned main wait reads the newest verifying run of that exact commit", async () => {
  mockApi([
    [
      { ...pipeline(12, "push", "running"), commit: "newer-main" },
      pipeline(11, "push", "running"),
      pipeline(10, "push", "failure"),
    ],
  ]);
  const result = await pinned(CI_HEAD);
  expect(result.sha).toBe(CI_HEAD);
  expect(result.tipSha).toBe(CI_HEAD);
  expect(result.run?.number).toBe(11);
});

test("a pinned main wait skips partial manual runs and reports none before one exists", async () => {
  mockApi([
    [
      {
        ...pipeline(9, "manual"),
        workflows: [{ name: "ci-noop", state: "success" }],
      },
      { ...pipeline(8, "push"), commit: "older-main" },
    ],
  ]);
  const result = await pinned(CI_HEAD);
  expect(result.run).toBeNull();
  expect(result.url).toBeNull();
});

test("a pinned main wait reads past a partial manual run to the commit's push run", async () => {
  const partial = {
    ...pipeline(160, "manual"),
    workflows: [{ name: "ci-noop", state: "success" }],
  };
  const others = Array.from({ length: 49 }, (_, index) => ({
    ...pipeline(159 - index, "push"),
    commit: `other-${String(index)}`,
  }));
  mockApi([[partial, ...others], [pipeline(100, "push")]]);
  const result = await pinned(CI_HEAD);
  expect(result.run?.number).toBe(100);
  expect(result.run?.event).toBe("push");
});

test("resolveMainHeadSha expands short hex prefixes via GitHub commits API and passes 40-char SHAs through", async () => {
  const fetchSpy = vi.fn(async (input: URL) => {
    const url = new URL(input);
    expect(url.pathname).toBe(
      `/repos/shepherdjerred/monorepo/commits/${CI_HEAD.slice(0, 12)}`,
    );
    return Response.json({ sha: CI_HEAD.toUpperCase() });
  });
  vi.stubGlobal("fetch", fetchSpy);
  const github = new GitHubClient("test");
  expect(await resolveMainHeadSha(github, CI_HEAD.toUpperCase())).toBe(CI_HEAD);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(await resolveMainHeadSha(github, CI_HEAD.slice(0, 12))).toBe(CI_HEAD);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

function mockFollowedApi(tipSha: string, pages: WoodpeckerPipeline[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/branches/main")) {
        return Response.json({ commit: { sha: tipSha } });
      }
      const num = /\/pipelines\/(\d+)$/u.exec(url.pathname)?.[1];
      return num === undefined
        ? Response.json(pages)
        : Response.json(pages.find((item) => item.number === Number(num)));
    }),
  );
}

test("getFollowedMainSnapshot returns a passing recovery at or after startSha even while newer main tips are running", async () => {
  const startSha = "1".repeat(40);
  const recoverySha = "2".repeat(40);
  const newestTip = "3".repeat(40);
  mockFollowedApi(newestTip, [
    { ...pipeline(20, "push", "running"), commit: newestTip },
    { ...pipeline(19, "push", "success"), commit: recoverySha },
    { ...pipeline(18, "push", "failure"), commit: startSha },
  ]);
  const snap = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    startSha,
  );
  expect(snap.sha).toBe(recoverySha);
  expect(snap.tipSha).toBe(newestTip);
  expect(snap.run?.number).toBe(19);
  expect(snap.run?.status).toBe("success");
});

test("getFollowedMainSnapshot keeps waiting when a newer main run after a passing recovery has failed", async () => {
  const startSha = "1".repeat(40);
  const recoverySha = "2".repeat(40);
  const failedTip = "3".repeat(40);
  mockFollowedApi(failedTip, [
    { ...pipeline(20, "push", "failure"), commit: failedTip },
    { ...pipeline(19, "push", "success"), commit: recoverySha },
    { ...pipeline(18, "push", "failure"), commit: startSha },
  ]);
  const snap = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    startSha,
  );
  expect(snap.sha).toBe(failedTip);
  expect(snap.run?.number).toBe(20);
  expect(snap.run?.status).toBe("failure");
});

test("getFollowedMainSnapshot ignores passing commits older than startSha", async () => {
  const olderGreen = "0".repeat(40);
  const startSha = "1".repeat(40);
  const runningTip = "2".repeat(40);
  mockFollowedApi(runningTip, [
    { ...pipeline(20, "push", "running"), commit: runningTip },
    { ...pipeline(18, "push", "failure"), commit: startSha },
    { ...pipeline(17, "push", "success"), commit: olderGreen },
  ]);
  const snap = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    startSha,
  );
  expect(snap.sha).toBe(runningTip);
  expect(snap.run?.number).toBe(20);
  expect(snap.run?.status).toBe("running");
});

test("getFollowedMainSnapshot preserves a failed commit verdict while its manual rerun is pending", async () => {
  const greenBase = "1".repeat(40);
  const failedCommit = "2".repeat(40);
  const unscheduledTip = "3".repeat(40);
  mockFollowedApi(failedCommit, [
    { ...pipeline(21, "manual", "running"), commit: failedCommit },
    { ...pipeline(19, "push", "failure"), commit: failedCommit },
    { ...pipeline(18, "push", "success"), commit: greenBase },
  ]);
  const pendingAtTip = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    greenBase,
  );
  expect(pendingAtTip.sha).toBe(failedCommit);
  expect(pendingAtTip.run?.number).toBe(21);
  expect(pendingAtTip.run?.status).toBe("running");

  mockFollowedApi(unscheduledTip, [
    { ...pipeline(21, "manual", "running"), commit: failedCommit },
    { ...pipeline(19, "push", "failure"), commit: failedCommit },
    { ...pipeline(18, "push", "success"), commit: greenBase },
  ]);
  const pendingBehindTip = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    greenBase,
  );
  expect(pendingBehindTip.sha).toBe(failedCommit);
  expect(pendingBehindTip.run?.number).toBe(19);
  expect(pendingBehindTip.run?.status).toBe("failure");

  mockFollowedApi(failedCommit, [
    { ...pipeline(21, "manual", "success"), commit: failedCommit },
    { ...pipeline(19, "push", "failure"), commit: failedCommit },
    { ...pipeline(18, "push", "success"), commit: greenBase },
  ]);
  const recovered = await getFollowedMainSnapshot(
    new GitHubClient("test"),
    config,
    greenBase,
  );
  expect(recovered.sha).toBe(failedCommit);
  expect(recovered.run?.number).toBe(21);
  expect(recovered.run?.status).toBe("success");
});
