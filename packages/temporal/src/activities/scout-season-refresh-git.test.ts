import { describe, expect, test } from "bun:test";
import {
  closeSeasonRefreshPr,
  refreshSeasonRefreshPrMetadata,
  type GitCommandRunner,
} from "./scout-season-refresh-git.ts";

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
