import { describe, expect, test } from "bun:test";
import { codexProvider } from "@shepherdjerred/code-review";
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
      return Promise.resolve({ exitCode: trackedExit, stdout: "", stderr: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
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
