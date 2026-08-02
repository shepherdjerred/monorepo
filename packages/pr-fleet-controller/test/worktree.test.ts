import { describe, expect, test } from "bun:test";
import type {
  CommandRequest,
  CommandResult,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type { PrIdentity } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { WorktreeManager } from "@shepherdjerred/pr-fleet-controller/src/worktree.ts";
import { identity } from "./fixtures.ts";

// Script a reuse of the worktree that is already ON this PR's branch, whose
// local HEAD is `localHead` while the remote PR head equals `pr.headSha`.
// `ancestorExit` is what `git merge-base --is-ancestor <remote> <local>` returns
// (0 = remote head is an ancestor of local head, i.e. the local branch is
// strictly ahead with unpushed commits).
function scriptWorktree(
  pr: PrIdentity,
  localHead: string,
  ancestorExit: number,
) {
  const pullRef = `refs/remotes/pull/${String(pr.number)}/head`;
  const resets: string[] = [];
  let mergeBaseArgs: string[] | null = null;

  const mustRun = (executable: string, args: string[]): Promise<string> => {
    if (executable === "git" && args[0] === "rev-parse") {
      if (args[1] === "--abbrev-ref") {
        return Promise.resolve(`${pr.headRefName}\n`);
      }
      if (args[1] === pullRef) {
        return Promise.resolve(`${pr.headSha}\n`);
      }
      if (args[1] === "HEAD") {
        return Promise.resolve(`${localHead}\n`);
      }
    }
    if (executable === "git" && args[0] === "reset") {
      resets.push(args[2] ?? "");
    }
    return Promise.resolve("");
  };

  const run = (request: CommandRequest): Promise<CommandResult> => {
    if (request.executable === "git" && request.args[0] === "merge-base") {
      mergeBaseArgs = request.args;
      return Promise.resolve({
        exitCode: ancestorExit,
        stdout: "",
        stderr: "",
      });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };

  const manager = new WorktreeManager({
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/pr-fleet",
    run,
    mustRun,
  });
  return { manager, resets, getMergeBaseArgs: () => mergeBaseArgs };
}

describe("worktree reassignment preserves unpushed work", () => {
  test("keeps a completed-but-unpublished commit ahead of the remote head", async () => {
    const pr = identity(7);
    const localHead = "c".repeat(40); // strictly ahead of the remote PR head
    const script = scriptWorktree(pr, localHead, 0);
    await script.manager.assignWorktreeBranch("/tmp/pr-fleet/stack-7", pr);
    // Reset to the LOCAL head (drop only working-tree edits, keep the commit),
    // NEVER to the remote head, which would delete the fix.
    expect(script.resets).toEqual([localHead]);
    expect(script.getMergeBaseArgs()).toEqual([
      "merge-base",
      "--is-ancestor",
      pr.headSha,
      localHead,
    ]);
  });

  test("resets to the remote head when there is no unpushed commit", async () => {
    const pr = identity(8);
    const script = scriptWorktree(pr, pr.headSha, 0);
    await script.manager.assignWorktreeBranch("/tmp/pr-fleet/stack-8", pr);
    // local HEAD already equals the remote head: no merge-base check, reset to it.
    expect(script.resets).toEqual([pr.headSha]);
    expect(script.getMergeBaseArgs()).toBeNull();
  });

  test("aligns to the remote head when the local branch diverged", async () => {
    const pr = identity(9);
    const localHead = "d".repeat(40);
    // merge-base --is-ancestor returns non-zero: the remote head is not an
    // ancestor of local HEAD, so local is behind/diverged, not a preserved fix.
    const script = scriptWorktree(pr, localHead, 1);
    await script.manager.assignWorktreeBranch("/tmp/pr-fleet/stack-9", pr);
    expect(script.resets).toEqual([pr.headSha]);
  });
});

const okRun = (): Promise<CommandResult> =>
  Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });

function managerWith(porcelain: string): WorktreeManager {
  const mustRun = (executable: string, args: string[]): Promise<string> => {
    if (executable === "git" && args[0] === "worktree" && args[1] === "list") {
      return Promise.resolve(porcelain);
    }
    return Promise.resolve("");
  };
  return new WorktreeManager({
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/pr-fleet",
    run: okRun,
    mustRun,
  });
}

describe("findWorktree is scoped to fleet-owned worktrees", () => {
  test("returns the fleet worktree, not the operator's own checkout of the branch", async () => {
    const porcelain = [
      // The operator's own checkout is listed first and must be skipped.
      "worktree /home/user/monorepo",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/feature/x",
      "",
      "worktree /tmp/pr-fleet/stack-7",
      `HEAD ${"b".repeat(40)}`,
      "branch refs/heads/feature/x",
      "",
    ].join("\n");
    expect(await managerWith(porcelain).findWorktree(["feature/x"])).toBe(
      "/tmp/pr-fleet/stack-7",
    );
  });

  test("returns null when only a non-fleet worktree has the branch", async () => {
    const porcelain = [
      "worktree /home/user/monorepo",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/feature/x",
      "",
    ].join("\n");
    expect(await managerWith(porcelain).findWorktree(["feature/x"])).toBeNull();
  });
});
