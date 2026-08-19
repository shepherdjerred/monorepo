import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepareManagedCheckout,
  resolveManagedCheckoutPaths,
} from "@shepherdjerred/pr-fleet-controller/src/managed-checkout.ts";
import type {
  CommandRequest,
  CommandResult,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import { runCommand } from "@shepherdjerred/pr-fleet-controller/src/process-runner.ts";

function commandResult(
  exitCode: number,
  stdout = "",
  stderr = "",
): CommandResult {
  return {
    exitCode,
    stdout,
    stderr,
    termination: "exit",
  };
}

function commandRunner(results: CommandResult[]): {
  requests: CommandRequest[];
  run: (request: CommandRequest) => Promise<CommandResult>;
} {
  const requests: CommandRequest[] = [];
  return {
    requests,
    run: async (request) => {
      requests.push(request);
      const result = results.shift();
      if (result === undefined) {
        throw new Error(`Unexpected command: ${request.args.join(" ")}`);
      }
      return result;
    },
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function mustRunGit(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand({
    executable: "git",
    args,
    cwd,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

describe("managed checkouts", () => {
  test("uses private sibling checkout and worktree directories by default", () => {
    const paths = resolveManagedCheckoutPaths({
      repository: "shepherdjerred/monorepo",
      stateDirectory: "/private/state/pr-fleet-controller",
    });

    expect(paths).toEqual({
      checkout:
        "/private/state/pr-fleet-controller/checkouts/repo-shepherdjerred--monorepo",
      worktreeRoot:
        "/private/state/pr-fleet-controller/worktrees/repo-shepherdjerred--monorepo",
    });
  });

  test("rejects overlapping custom checkout and worktree paths", () => {
    expect(() =>
      resolveManagedCheckoutPaths({
        repository: "shepherdjerred/monorepo",
        stateDirectory: "/private/state/pr-fleet-controller",
        checkout: "/private/state/pr-fleet-controller/checkout",
        worktreeRoot: "/private/state/pr-fleet-controller/checkout/worktrees",
      }),
    ).toThrow("must be disjoint");

    expect(() =>
      resolveManagedCheckoutPaths({
        repository: "shepherdjerred/monorepo",
        stateDirectory: "/private/state/pr-fleet-controller",
        checkout: "/private/state/pr-fleet-controller/checkouts",
        worktreeRoot: "/private/state/pr-fleet-controller",
      }),
    ).toThrow("must be disjoint");
  });

  test("creates an isolated clone and copies local git-spice metadata", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const parent = await temporaryDirectory("pr-fleet-managed-");
    const checkout = path.join(parent, "checkout");
    const worktreeRoot = path.join(parent, "worktrees");
    const runner = commandRunner([
      commandResult(0, "https://github.com/example/repository.git\n"),
      commandResult(0),
      commandResult(0),
      commandResult(0),
      commandResult(0),
    ]);

    try {
      await expect(
        prepareManagedCheckout({
          sourceCheckout,
          checkout,
          worktreeRoot,
          run: runner.run,
        }),
      ).resolves.toEqual({ checkout, worktreeRoot });
      expect(
        runner.requests.map((request) => ({
          cwd: request.cwd,
          args: request.args,
        })),
      ).toEqual([
        {
          cwd: sourceCheckout,
          args: ["remote", "get-url", "origin"],
        },
        {
          cwd: parent,
          args: [
            "clone",
            "--origin",
            "origin",
            "https://github.com/example/repository.git",
            checkout,
          ],
        },
        {
          cwd: sourceCheckout,
          args: ["show-ref", "--verify", "--quiet", "refs/spice/data"],
        },
        {
          cwd: checkout,
          args: ["fetch", sourceCheckout, "+refs/spice/data:refs/spice/data"],
        },
        {
          cwd: checkout,
          args: ["fetch", "--prune", "origin"],
        },
      ]);
      for (const request of runner.requests) {
        expect(request.maxOutputBytes).toBe(16_384);
        expect(request.sensitiveOutput).toBe(true);
      }
    } finally {
      await Promise.all([
        rm(sourceCheckout, { recursive: true, force: true }),
        rm(parent, { recursive: true, force: true }),
      ]);
    }
  });

  test("creates a clean clone and transfers git-spice metadata with Git", async () => {
    const parent = await temporaryDirectory("pr-fleet-git-");
    const sourceCheckout = path.join(parent, "source");
    const remote = path.join(parent, "remote.git");
    const checkout = path.join(parent, "managed");
    const worktreeRoot = path.join(parent, "worktrees");

    try {
      await mustRunGit(parent, [
        "init",
        "--initial-branch=main",
        sourceCheckout,
      ]);
      await mustRunGit(sourceCheckout, [
        "config",
        "user.email",
        "fleet@example.test",
      ]);
      await mustRunGit(sourceCheckout, [
        "config",
        "user.name",
        "PR Fleet Test",
      ]);
      await writeFile(path.join(sourceCheckout, "README.md"), "source\n");
      await mustRunGit(sourceCheckout, ["add", "README.md"]);
      await mustRunGit(sourceCheckout, ["commit", "-m", "test: seed source"]);
      await mustRunGit(parent, ["init", "--bare", remote]);
      await mustRunGit(sourceCheckout, ["remote", "add", "origin", remote]);
      await mustRunGit(sourceCheckout, ["push", "-u", "origin", "main"]);
      await mustRunGit(sourceCheckout, [
        "update-ref",
        "refs/spice/data",
        "HEAD",
      ]);

      await prepareManagedCheckout({
        sourceCheckout,
        checkout,
        worktreeRoot,
        run: runCommand,
      });

      expect(await mustRunGit(checkout, ["status", "--porcelain=v1"])).toBe("");
      expect(await mustRunGit(checkout, ["rev-parse", "refs/spice/data"])).toBe(
        await mustRunGit(sourceCheckout, ["rev-parse", "refs/spice/data"]),
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("managed checkout safety", () => {
  test("refuses to reuse a dirty managed clone without resetting it", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const checkout = await temporaryDirectory("pr-fleet-managed-");
    const worktreeRoot = path.join(path.dirname(checkout), "worktrees");
    const runner = commandRunner([
      commandResult(0, "true\n"),
      commandResult(0, " M packages/controller.ts\0"),
    ]);

    try {
      await expect(
        prepareManagedCheckout({
          sourceCheckout,
          checkout,
          worktreeRoot,
          run: runner.run,
        }),
      ).rejects.toThrow("has local changes");
      expect(runner.requests.map((request) => request.args)).toEqual([
        ["rev-parse", "--is-inside-work-tree"],
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      ]);
    } finally {
      await Promise.all([
        rm(sourceCheckout, { recursive: true, force: true }),
        rm(checkout, { recursive: true, force: true }),
      ]);
    }
  });

  test("rejects a clean managed clone for a different repository", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const checkout = await temporaryDirectory("pr-fleet-managed-");
    const runner = commandRunner([
      commandResult(0, "true\n"),
      commandResult(0),
      commandResult(0, "https://github.com/example/source.git\n"),
      commandResult(0, "https://github.com/example/other.git\n"),
    ]);

    try {
      await expect(
        prepareManagedCheckout({
          sourceCheckout,
          checkout,
          worktreeRoot: path.join(path.dirname(checkout), "worktrees"),
          run: runner.run,
        }),
      ).rejects.toThrow("different repository");
    } finally {
      await Promise.all([
        rm(sourceCheckout, { recursive: true, force: true }),
        rm(checkout, { recursive: true, force: true }),
      ]);
    }
  });

  test("cleans a partial clone after the initial clone fails", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const parent = await temporaryDirectory("pr-fleet-managed-");
    const checkout = path.join(parent, "checkout");
    const requests: CommandRequest[] = [];
    const run = async (request: CommandRequest): Promise<CommandResult> => {
      requests.push(request);
      if (request.args[0] === "remote") {
        return commandResult(0, "https://github.com/example/repository.git\n");
      }
      if (request.args[0] === "clone") {
        await mkdir(checkout);
        await writeFile(path.join(checkout, "partial"), "incomplete\n");
        return commandResult(128, "", "clone interrupted");
      }
      throw new Error(`Unexpected command: ${request.args.join(" ")}`);
    };

    try {
      await expect(
        prepareManagedCheckout({
          sourceCheckout,
          checkout,
          worktreeRoot: path.join(parent, "worktrees"),
          run,
        }),
      ).rejects.toThrow("Could not create managed checkout");
      expect(await Bun.file(path.join(checkout, "partial")).exists()).toBe(
        false,
      );
      expect(requests.map((request) => request.args[0])).toEqual([
        "remote",
        "clone",
      ]);
    } finally {
      await Promise.all([
        rm(sourceCheckout, { recursive: true, force: true }),
        rm(parent, { recursive: true, force: true }),
      ]);
    }
  });

  test("rejects the checkout that launched the controller", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const runner = commandRunner([]);

    try {
      await expect(
        prepareManagedCheckout({
          sourceCheckout,
          checkout: sourceCheckout,
          worktreeRoot: path.join(sourceCheckout, "worktrees"),
          run: runner.run,
        }),
      ).rejects.toThrow("must differ from the checkout that launched");
      expect(runner.requests).toEqual([]);
    } finally {
      await rm(sourceCheckout, { recursive: true, force: true });
    }
  });

  test("continues when the source checkout has no git-spice metadata", async () => {
    const sourceCheckout = await temporaryDirectory("pr-fleet-source-");
    const parent = await temporaryDirectory("pr-fleet-managed-");
    const checkout = path.join(parent, "checkout");
    const runner = commandRunner([
      commandResult(0, "https://github.com/example/repository.git\n"),
      commandResult(0),
      commandResult(1),
      commandResult(0),
      commandResult(0),
    ]);

    try {
      await prepareManagedCheckout({
        sourceCheckout,
        checkout,
        worktreeRoot: path.join(parent, "worktrees"),
        run: runner.run,
      });
      expect(runner.requests.map((request) => request.args)).toEqual([
        ["remote", "get-url", "origin"],
        [
          "clone",
          "--origin",
          "origin",
          "https://github.com/example/repository.git",
          checkout,
        ],
        ["show-ref", "--verify", "--quiet", "refs/spice/data"],
        ["update-ref", "-d", "refs/spice/data"],
        ["fetch", "--prune", "origin"],
      ]);
    } finally {
      await Promise.all([
        rm(sourceCheckout, { recursive: true, force: true }),
        rm(parent, { recursive: true, force: true }),
      ]);
    }
  });
});
