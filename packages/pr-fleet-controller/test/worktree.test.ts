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
        termination: "exit",
      });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      termination: "exit",
    });
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
  Promise.resolve({
    exitCode: 0,
    stdout: "",
    stderr: "",
    termination: "exit",
  });

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

describe("findWorktree prefers a fleet worktree, falls back to the operator's", () => {
  test("prefers the fleet worktree even when the operator also has the branch", async () => {
    const porcelain = [
      // The operator's own checkout is listed first but the fleet worktree wins.
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

  test("falls back to the operator worktree so the fleet can reuse it in place", async () => {
    // Only the operator holds the branch; git forbids a second checkout of it,
    // so reusing the operator worktree is the only way to make progress. The
    // dirty guard in assignWorktreeBranch keeps that reuse safe.
    const porcelain = [
      "worktree /home/user/monorepo",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/feature/x",
      "",
    ].join("\n");
    expect(await managerWith(porcelain).findWorktree(["feature/x"])).toBe(
      "/home/user/monorepo",
    );
  });

  test("returns null when no worktree has the branch", async () => {
    const porcelain = [
      "worktree /home/user/monorepo",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
    ].join("\n");
    expect(await managerWith(porcelain).findWorktree(["feature/x"])).toBeNull();
  });
});

// Reuse of an operator-owned worktree (outside the fleet root) must never
// `reset --hard` uncommitted operator edits. Script the branch-check, the
// pull-ref fetch/rev-parse, and a `status --porcelain` whose output signals
// whether the operator worktree is dirty.
function scriptOperatorWorktree(pr: PrIdentity, porcelainStatus: string) {
  const pullRef = `refs/remotes/pull/${String(pr.number)}/head`;
  const resets: string[] = [];
  const mustRun = (executable: string, args: string[]): Promise<string> => {
    if (executable === "git" && args[0] === "rev-parse") {
      if (args[1] === "--abbrev-ref") {
        return Promise.resolve(`${pr.headRefName}\n`);
      }
      if (args[1] === pullRef || args[1] === "HEAD") {
        return Promise.resolve(`${pr.headSha}\n`);
      }
    }
    if (executable === "git" && args[0] === "status") {
      return Promise.resolve(porcelainStatus);
    }
    if (executable === "git" && args[0] === "reset") {
      resets.push(args[2] ?? "");
    }
    return Promise.resolve("");
  };
  const manager = new WorktreeManager({
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/pr-fleet",
    run: okRun,
    mustRun,
  });
  return { manager, resets };
}

describe("assignWorktreeBranch guards operator worktree reuse", () => {
  test("refuses a dirty operator worktree instead of discarding its edits", async () => {
    const pr = identity(14);
    const script = scriptOperatorWorktree(pr, " M packages/x/file.ts\n");
    await expect(
      // Operator worktree lives outside the fleet root.
      script.manager.assignWorktreeBranch("/home/user/monorepo", pr),
    ).rejects.toThrow(/uncommitted changes; refusing to reuse/);
    // Never touch the working tree while it is dirty.
    expect(script.resets).toEqual([]);
  });

  test("reuses a clean operator worktree in place", async () => {
    const pr = identity(15);
    const script = scriptOperatorWorktree(pr, "");
    await script.manager.assignWorktreeBranch("/home/user/monorepo", pr);
    // Clean and already at the PR head: aligned to it, no operator work lost.
    expect(script.resets).toEqual([pr.headSha]);
  });
});

// Provisioning must recognize its own stack worktree even when a restack halted
// on a conflict left it DETACHED (no `branch refs/heads/...` line), reuse it by
// path, and abort the incomplete rebase — never `git worktree add` a second
// worktree at the occupied path (which fails and pauses the PR).
function scriptProvision(
  stackId: string,
  porcelain: string,
  rebaseExit: number,
) {
  const calls: string[][] = [];
  const mustRun = (executable: string, args: string[]): Promise<string> => {
    calls.push([executable, ...args]);
    if (executable === "git" && args[0] === "worktree" && args[1] === "list") {
      return Promise.resolve(porcelain);
    }
    return Promise.resolve("");
  };
  const run = (request: CommandRequest): Promise<CommandResult> => {
    calls.push([request.executable, ...request.args]);
    if (
      request.executable === "git" &&
      request.args[0] === "rev-parse" &&
      request.args.includes("REBASE_HEAD")
    ) {
      return Promise.resolve({
        exitCode: rebaseExit,
        stdout: "",
        stderr: "",
        termination: "exit",
      });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      termination: "exit",
    });
  };
  const manager = new WorktreeManager({
    checkout: "/tmp/checkout",
    worktreeRoot: "/tmp/pr-fleet",
    run,
    mustRun,
  });
  const invoked = (predicate: (call: string[]) => boolean): boolean =>
    calls.some((call) => predicate(call));
  return { manager, stackPath: `/tmp/pr-fleet/stack-${stackId}`, invoked };
}

describe("provisionWorktree reuses a detached fleet stack worktree", () => {
  test("aborts the halted rebase and reuses the path when detached", async () => {
    const pr = identity(11);
    // The stack worktree is registered but DETACHED (no branch line), so the
    // branch-based findWorktree misses it; a restack is mid-conflict.
    const porcelain = [
      "worktree /tmp/pr-fleet/stack-abc",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "",
    ].join("\n");
    const script = scriptProvision("abc", porcelain, 0);
    const result = await script.manager.provisionWorktree(pr, "abc");
    expect(result).toBe(script.stackPath);
    expect(
      script.invoked(
        (call) =>
          call[0] === "git" && call[1] === "rebase" && call[2] === "--abort",
      ),
    ).toBe(true);
    // Never add a second worktree at the occupied path.
    expect(
      script.invoked(
        (call) =>
          call[0] === "git" && call[1] === "worktree" && call[2] === "add",
      ),
    ).toBe(false);
  });

  test("reuses without aborting when no rebase is in progress", async () => {
    const pr = identity(12);
    const porcelain = [
      "worktree /tmp/pr-fleet/stack-def",
      `HEAD ${"c".repeat(40)}`,
      "detached",
      "",
    ].join("\n");
    const script = scriptProvision("def", porcelain, 1);
    const result = await script.manager.provisionWorktree(pr, "def");
    expect(result).toBe(script.stackPath);
    expect(
      script.invoked(
        (call) =>
          call[0] === "git" && call[1] === "rebase" && call[2] === "--abort",
      ),
    ).toBe(false);
  });

  test("adds a fresh worktree when none is registered at the stack path", async () => {
    const pr = identity(13);
    // No worktree registered under the fleet root.
    const porcelain = [
      "worktree /home/user/monorepo",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
    ].join("\n");
    const script = scriptProvision("ghi", porcelain, 1);
    const result = await script.manager.provisionWorktree(pr, "ghi");
    expect(result).toBe(script.stackPath);
    expect(
      script.invoked(
        (call) =>
          call[0] === "git" && call[1] === "worktree" && call[2] === "add",
      ),
    ).toBe(true);
    expect(
      script.invoked(
        (call) =>
          call[0] === "git" && call[1] === "rebase" && call[2] === "--abort",
      ),
    ).toBe(false);
  });
});
