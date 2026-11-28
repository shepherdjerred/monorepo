import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import { getMainRun, getMainStatus, resolveMainHeadSha } from "#lib/ci/main.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import {
  CI_HEAD,
  MAIN_WOODPECKER_CONFIG as config,
  mainPipeline as pipeline,
} from "./fixtures.ts";

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
      state: workflow.name === "delivery-publish" ? "skipped" : "success",
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

test("superseded canceled and killed main pushes do not turn main red while a newer verifying push runs", async () => {
  const canceledBurst = Array.from({ length: 55 }, (_, index) => ({
    ...pipeline(200 - index, "push", index % 2 === 0 ? "canceled" : "killed"),
    commit: `superseded-${String(index)}`,
  }));
  mockApi([
    [
      { ...pipeline(201, "push", "running"), commit: CI_HEAD },
      ...canceledBurst.slice(0, 49),
    ],
    [
      ...canceledBurst.slice(49),
      { ...pipeline(140, "push", "success"), commit: "last-green" },
    ],
  ]);
  const result = await status();
  expect(result.state).toBe("pending");
  expect(result.latest?.number).toBe(201);
  expect(result.lastVerdict?.number).toBe(140);
});

test("superseded canceled pushes still preserve an older failed main verdict across pagination", async () => {
  const canceledBurst = Array.from({ length: 50 }, (_, index) => ({
    ...pipeline(300 - index, "push", "canceled"),
    commit: `superseded-${String(index)}`,
  }));
  mockApi([
    [
      { ...pipeline(301, "push", "running"), commit: CI_HEAD },
      ...canceledBurst.slice(0, 49),
    ],
    [...canceledBurst.slice(49), failedPush()],
  ]);
  const result = await status();
  expect(result.state).toBe("red");
  expect(result.latest?.number).toBe(301);
  expect(result.lastVerdict?.number).toBe(7);
});

test("manually killing the tip main push keeps main red when no newer verifying run exists", async () => {
  const partialManual = {
    ...pipeline(12, "manual", "success"),
    workflows: [{ name: "ci-noop", state: "success" }],
  };
  mockApi([
    [
      partialManual,
      pipeline(11, "push", "killed"),
      { ...pipeline(10, "push", "success"), commit: "older-green" },
    ],
  ]);
  const result = await status();
  expect(result.state).toBe("red");
  expect(result.latest?.number).toBe(11);
  expect(result.lastVerdict?.number).toBe(11);
});

function stubPinnedMainFetch(options: {
  tipSha: string;
  runs: (ReturnType<typeof pipeline> & { commit: string })[];
  compareStatus: string;
  compares?: string[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/branches/main")) {
        return Promise.resolve(
          Response.json({ commit: { sha: options.tipSha } }),
        );
      }
      const compare = /\/compare\/([^/]+)$/.exec(url.pathname)?.[1];
      if (compare !== undefined) {
        options.compares?.push(compare);
        return Promise.resolve(
          Response.json({ status: options.compareStatus }),
        );
      }
      const number = /\/pipelines\/(\d+)$/.exec(url.pathname)?.[1];
      if (number !== undefined) {
        const found = options.runs.find(
          (item) => item.number === Number(number),
        );
        return found === undefined
          ? Promise.reject(new Error(`Unexpected pipeline ${number}`))
          : Promise.resolve(Response.json(found));
      }
      return Promise.resolve(Response.json(options.runs));
    }),
  );
}

test("pinned main wait follows the earliest non-superseded descendant when the pinned push was canceled", async () => {
  const pinnedSha = "1".repeat(40);
  const canceledNext = "2".repeat(40);
  const keptRunning = "3".repeat(40);
  const newestTip = "4".repeat(40);
  const compares: string[] = [];
  stubPinnedMainFetch({
    tipSha: newestTip,
    compareStatus: "ahead",
    compares,
    runs: [
      { ...pipeline(103, "push", "pending"), commit: newestTip, finished: 0 },
      { ...pipeline(102, "push", "running"), commit: keptRunning },
      { ...pipeline(101, "push", "canceled"), commit: canceledNext },
      { ...pipeline(100, "push", "canceled"), commit: pinnedSha },
    ],
  });

  const result = await pinned(pinnedSha);
  expect(result.sha).toBe(pinnedSha);
  expect(result.tipSha).toBe(newestTip);
  expect(result.run?.number).toBe(102);
  expect(compares).toEqual([`${pinnedSha}...${keptRunning}`]);
});

test("pinned main wait refuses non-descendant newer commits and keeps a killed tip failed", async () => {
  const pinnedSha = "5".repeat(40);
  const divergedSha = "6".repeat(40);
  stubPinnedMainFetch({
    tipSha: divergedSha,
    compareStatus: "diverged",
    runs: [
      { ...pipeline(51, "push", "running"), commit: divergedSha },
      { ...pipeline(50, "push", "canceled"), commit: pinnedSha },
    ],
  });

  const result = await pinned(pinnedSha);
  expect(result.run?.number).toBe(50);
  expect(result.run?.status).toBe("canceled");
});
