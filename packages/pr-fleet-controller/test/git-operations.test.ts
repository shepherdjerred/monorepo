import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexProvider } from "@shepherdjerred/code-review";
import { TelemetryCaptureError } from "@shepherdjerred/pr-fleet-controller/src/controller-telemetry.ts";
import { buildPrState } from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import { GitOperations } from "@shepherdjerred/pr-fleet-controller/src/git-operations.ts";
import type {
  CommandRequest,
  CommandResult,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { evidence, identity } from "./fixtures.ts";

function makePr(crossRepository = false): PrState {
  const id = identity(42, { crossRepository });
  const base = buildPrState(
    { identity: id, evidence: evidence(id), stackId: "pr-42" },
    undefined,
    undefined,
    "openai/gpt-5",
  ).state;
  return { ...base, worktree: "/tmp/pr-fleet-wt-42" };
}

// `trackedExit === 0` simulates a git-spice-tracked branch (the state ref has a
// `branches/<name>` entry); non-zero simulates a native / unstacked branch.
function fakeGit(trackedExit: number) {
  const mustCalls: string[][] = [];
  const run = (request: CommandRequest): Promise<CommandResult> => {
    if (request.executable === "git" && request.args[0] === "cat-file") {
      return Promise.resolve({
        exitCode: trackedExit,
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
  const mustRun = (executable: string, args: string[]): Promise<string> => {
    mustCalls.push([executable, ...args]);
    if (executable === "gh" && args.includes("headRefOid")) {
      return Promise.resolve(JSON.stringify({ headRefOid: "a".repeat(40) }));
    }
    return Promise.resolve("");
  };
  return { run, mustRun, mustCalls };
}

function prAt(dir: string): PrState {
  return { ...makePr(), worktree: dir };
}

function operations(fake: ReturnType<typeof fakeGit>): GitOperations {
  return new GitOperations({
    repo: "shepherdjerred/monorepo",
    provider: codexProvider,
    run: fake.run,
    mustRun: fake.mustRun,
  });
}

describe("stack ownership routing", () => {
  test("publishes a git-spice branch through git-spice submit", async () => {
    const fake = fakeGit(0);
    const result = await operations(fake).publishRestack(makePr());
    expect(result.headSha).toBe("a".repeat(40));
    expect(
      fake.mustCalls.some(
        (call) => call[0] === "git-spice" && call.includes("submit"),
      ),
    ).toBe(true);
    expect(
      fake.mustCalls.some((call) => call[0] === "git" && call.includes("push")),
    ).toBe(false);
  });

  test("publishes a native branch through a plain-gh force-with-lease push", async () => {
    const fake = fakeGit(1);
    const pr = makePr();
    const result = await operations(fake).publishRestack(pr);
    expect(result.headSha).toBe("a".repeat(40));
    expect(
      fake.mustCalls.some(
        (call) =>
          call[0] === "git" &&
          call.includes("--force-with-lease") &&
          call.includes(`HEAD:refs/heads/${pr.identity.headRefName}`),
      ),
    ).toBe(true);
    expect(fake.mustCalls.some((call) => call[0] === "git-spice")).toBe(false);
  });

  test("fails fast on a fork PR instead of pushing to the base repository", async () => {
    const fake = fakeGit(0);
    await expect(operations(fake).publishRestack(makePr(true))).rejects.toThrow(
      /cross-repository/,
    );
    // Never pushes (origin is the base repo, not the fork) and never runs git-spice.
    expect(
      fake.mustCalls.some((call) => call[0] === "git" && call.includes("push")),
    ).toBe(false);
    expect(fake.mustCalls.some((call) => call[0] === "git-spice")).toBe(false);
  });

  test("refuses to restack a non-git-spice branch instead of misapplying git-spice", async () => {
    const fake = fakeGit(1);
    await expect(operations(fake).startRestack(makePr())).rejects.toThrow(
      /not git-spice-owned/,
    );
    expect(fake.mustCalls.some((call) => call[0] === "git-spice")).toBe(false);
  });

  test("restacks a git-spice branch through git-spice", async () => {
    const fake = fakeGit(0);
    const result = await operations(fake).startRestack(makePr());
    expect(result.exitCode).toBe(0);
  });
});

describe("validatePaths rejects directory pathspecs", () => {
  let worktree: string;

  beforeAll(async () => {
    worktree = await mkdtemp(path.join(tmpdir(), "pr-fleet-validate-"));
    await writeFile(path.join(worktree, "file.ts"), "export const x = 1;\n");
    await mkdir(path.join(worktree, "pkgdir"));
  });

  afterAll(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  test("accepts a specific existing file", async () => {
    const fake = fakeGit(0);
    const result = await operations(fake).continueRestack(prAt(worktree), [
      "file.ts",
    ]);
    expect(result.exitCode).toBe(0);
    expect(
      fake.mustCalls.some(
        (call) =>
          call[0] === "git" && call[1] === "add" && call.includes("file.ts"),
      ),
    ).toBe(true);
  });

  test("does not mutate the index after command capture fails", async () => {
    const fake = fakeGit(0);
    const captureFailure = new TelemetryCaptureError(
      "command.completed",
      new Error("state volume is full"),
    );
    const git = new GitOperations({
      repo: "shepherdjerred/monorepo",
      provider: codexProvider,
      run: fake.run,
      mustRun: (executable, args) => {
        if (executable === "git" && args[0] === "commit") {
          fake.mustCalls.push([executable, ...args]);
          return Promise.reject(captureFailure);
        }
        return fake.mustRun(executable, args);
      },
    });

    await expect(
      git.publishFix(prAt(worktree), ["file.ts"], "fix capture"),
    ).rejects.toBe(captureFailure);
    expect(
      fake.mustCalls.filter((call) => call[0] === "git" && call[1] === "reset"),
    ).toEqual([]);
  });

  test("accepts a deleted (missing) file as an explicit deletion", async () => {
    const fake = fakeGit(0);
    const result = await operations(fake).continueRestack(prAt(worktree), [
      "gone.ts",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("accepts a deletion whose parent directory was also removed", async () => {
    const fake = fakeGit(0);
    const result = await operations(fake).continueRestack(prAt(worktree), [
      "removed-parent/nested/gone.ts",
    ]);
    expect(result.exitCode).toBe(0);
    expect(
      fake.mustCalls.some(
        (call) =>
          call[0] === "git" &&
          call[1] === "add" &&
          call.includes("removed-parent/nested/gone.ts"),
      ),
    ).toBe(true);
  });

  test("rejects a directory pathspec and never stages it", async () => {
    const fake = fakeGit(0);
    await expect(
      operations(fake).continueRestack(prAt(worktree), ["pkgdir"]),
    ).rejects.toThrow(/not a specific file/);
    expect(
      fake.mustCalls.some((call) => call[0] === "git" && call[1] === "add"),
    ).toBe(false);
  });

  test("rejects the '.' whole-worktree pathspec", async () => {
    const fake = fakeGit(0);
    await expect(
      operations(fake).continueRestack(prAt(worktree), ["."]),
    ).rejects.toThrow();
  });
});
