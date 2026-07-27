import { describe, expect, test } from "bun:test";
import {
  closeSeasonRefreshPr,
  parsePorcelainPaths,
  refreshSeasonRefreshPrMetadata,
  type GitCommandRunner,
} from "./scout-season-refresh-git.ts";

describe("parsePorcelainPaths", () => {
  test("worktree-modified file (leading-space ` M` prefix) keeps its full path", () => {
    // Regression: an earlier `.trim()` stripped the leading space, shifting the
    // slice one char into the path so it never matched a committed constant.
    const status =
      " M packages/frontend/src/data/generated/scout-showcase-assets.json";
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/src/data/generated/scout-showcase-assets.json",
    ]);
  });

  test("staged-modified (`M ` prefix) and untracked (`??` prefix) paths parse whole", () => {
    const status = ["M  packages/a/staged.ts", "?? packages/b/new.ts"].join(
      "\n",
    );
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/a/staged.ts",
      "packages/b/new.ts",
    ]);
  });

  test("mixed statuses in one listing all parse correctly", () => {
    const status = [
      " M packages/frontend/one.png",
      "?? packages/frontend/two.png",
      "M  packages/frontend/three.json",
    ].join("\n");
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/one.png",
      "packages/frontend/two.png",
      "packages/frontend/three.json",
    ]);
  });

  test("empty output and trailing newline yield no paths", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
    expect(parsePorcelainPaths(" M packages/a.ts\n")).toEqual([
      "packages/a.ts",
    ]);
  });
});

describe("shared proposal PR reconciliation", () => {
  test("refreshes the title and body of a reused PR", async () => {
    const calls: string[][] = [];
    const commandRunner: GitCommandRunner = (command) => {
      calls.push(command);
      return Promise.resolve("");
    };

    await refreshSeasonRefreshPrMetadata(
      {
        repoDir: "/tmp/repo",
        ghToken: "token",
        repoSlug: "owner/repo",
        title: "new title",
        body: "new body",
      },
      "https://github.com/owner/repo/pull/1",
      commandRunner,
    );

    expect(calls).toEqual([
      [
        "gh",
        "pr",
        "edit",
        "https://github.com/owner/repo/pull/1",
        "--repo",
        "owner/repo",
        "--title",
        "new title",
        "--body",
        "new body",
      ],
    ]);
  });

  test("closes and deletes an obsolete shared proposal branch", async () => {
    const calls: string[][] = [];
    const responses = ["https://github.com/owner/repo/pull/1", ""];
    const commandRunner: GitCommandRunner = (command) => {
      calls.push(command);
      return Promise.resolve(responses.shift() ?? "");
    };

    const closedPr = await closeSeasonRefreshPr(
      {
        repoDir: "/tmp/repo",
        branch: "chore/scout-queue-windows",
        ghToken: "token",
        repoSlug: "owner/repo",
        reason: "Fresh evidence removed the drift.",
      },
      commandRunner,
    );

    expect(closedPr).toBe("https://github.com/owner/repo/pull/1");
    expect(calls).toEqual([
      [
        "gh",
        "pr",
        "list",
        "--repo",
        "owner/repo",
        "--head",
        "chore/scout-queue-windows",
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        '.[0].url // ""',
      ],
      [
        "gh",
        "pr",
        "close",
        "https://github.com/owner/repo/pull/1",
        "--repo",
        "owner/repo",
        "--comment",
        "Fresh evidence removed the drift.",
        "--delete-branch",
      ],
    ]);
  });
});
