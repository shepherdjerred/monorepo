import { describe, expect, test } from "vitest";
import {
  createDataDragonPr,
  getPrRevisionState,
  isPrBasedOnCurrentMain,
} from "./data-dragon-pr.ts";

const ARGS = {
  repoSlug: "shepherdjerred/monorepo",
  repoDir: "/tmp/clone",
  branch: "chore/scout-data-dragon-16.15.1",
  base: "main",
  title: "chore: update Scout Data Dragon to 16.15.1",
  body: "body",
  version: "16.15.1",
  token: "gh-token",
};

describe("createDataDragonPr", () => {
  test("returns the created PR url on a clean create", async () => {
    let createCalls = 0;
    const result = await createDataDragonPr(ARGS, {
      run: async (command) => {
        createCalls += 1;
        expect(command.slice(0, 3)).toEqual(["gh", "pr", "create"]);
        expect(command).toContain(ARGS.branch);
        // runCommand trims stdout by default, so a real create yields no newline.
        return "https://github.com/shepherdjerred/monorepo/pull/9";
      },
      // Never consulted on the happy path.
      findOnHead: async () => {
        throw new Error("findOnHead must not run when create succeeds");
      },
    });

    expect(result).toEqual({
      url: "https://github.com/shepherdjerred/monorepo/pull/9",
      recovered: false,
    });
    expect(createCalls).toBe(1);
  });

  test("recovers a sibling attempt's PR when create races and loses", async () => {
    // The concurrent-retry window: `gh pr create` fails because a sibling
    // attempt already opened the PR on the same deterministic branch. The
    // authenticated `--head` lookup finds it, so we recover instead of erroring.
    const result = await createDataDragonPr(ARGS, {
      run: async () => {
        throw new Error("a pull request for branch already exists");
      },
      findOnHead: async (repoSlug, branch, version) => {
        expect(repoSlug).toBe(ARGS.repoSlug);
        expect(branch).toBe(ARGS.branch);
        expect(version).toBe(ARGS.version);
        return "https://github.com/shepherdjerred/monorepo/pull/7";
      },
    });

    expect(result).toEqual({
      url: "https://github.com/shepherdjerred/monorepo/pull/7",
      recovered: true,
    });
  });

  test("rethrows a genuine create failure when no bot PR exists on the head", async () => {
    const failure = new Error("gh pr create: HTTP 500");
    await expect(
      createDataDragonPr(ARGS, {
        run: async () => {
          throw failure;
        },
        // A miss: no authenticated bot PR on the head, so create must rethrow.
        findOnHead: async () => new Map<string, string>().get(ARGS.branch),
      }),
    ).rejects.toBe(failure);
  });
});

describe("isPrBasedOnCurrentMain", () => {
  test("detects a current base", async () => {
    const result = await isPrBasedOnCurrentMain({
      repoSlug: ARGS.repoSlug,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/9",
      token: ARGS.token,
      run: async (command) =>
        command[1] === "pr"
          ? JSON.stringify({
              baseRefOid: "abc",
              headRefOid: "def",
              headRefName: ARGS.branch,
            })
          : JSON.stringify({ object: { sha: "abc" } }),
    });

    expect(result).toBe(true);
  });

  test("detects a stale base", async () => {
    const result = await isPrBasedOnCurrentMain({
      repoSlug: ARGS.repoSlug,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/9",
      token: ARGS.token,
      run: async (command) =>
        command[1] === "pr"
          ? JSON.stringify({
              baseRefOid: "old",
              headRefOid: "def",
              headRefName: ARGS.branch,
            })
          : JSON.stringify({ object: { sha: "new" } }),
    });

    expect(result).toBe(false);
  });

  test("returns both PR revisions and the current main revision", async () => {
    const result = await getPrRevisionState({
      repoSlug: ARGS.repoSlug,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/9",
      token: ARGS.token,
      run: async (command) =>
        command[1] === "pr"
          ? JSON.stringify({
              baseRefOid: "base",
              headRefOid: "head",
              headRefName: ARGS.branch,
            })
          : JSON.stringify({ object: { sha: "main" } }),
    });

    expect(result).toEqual({
      baseRefOid: "base",
      headRefOid: "head",
      headRefName: ARGS.branch,
      mainRefOid: "main",
    });
  });
});
