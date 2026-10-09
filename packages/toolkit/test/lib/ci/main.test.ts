import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "#lib/ci/github.ts";
import { getMainStatus } from "#lib/ci/main.ts";
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
