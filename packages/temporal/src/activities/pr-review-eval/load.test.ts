import { describe, expect, it } from "bun:test";
import {
  checkoutFixtureRepo,
  runFixtureGitCommand,
  type FixtureGitCommand,
  type FixtureGitEnv,
} from "./load.ts";

const gitEnv: FixtureGitEnv = {
  GH_TOKEN: "secret-token",
  GIT_ASKPASS: "/tmp/git-askpass.sh",
  GIT_TERMINAL_PROMPT: "0",
};

describe("checkoutFixtureRepo", () => {
  it("uses git askpass clone/fetch/checkout commands for pinned fixtures", async () => {
    const commands: FixtureGitCommand[] = [];
    const heartbeats: { phase: "clone" | "fetch-pin" }[] = [];
    const result = await checkoutFixtureRepo({
      fixturesRepoUrl: "https://github.com/example/private-fixtures.git",
      repoDir: "/tmp/fixtures/repo",
      pin: "abc123",
      gitEnv,
      heartbeat: (event) => {
        heartbeats.push(event);
      },
      runGit: async (command) => {
        commands.push(command);
        if (command.args.join(" ") === "git rev-parse HEAD") {
          return commands.length === 2 ? "initial-sha\n" : "abc123\n";
        }
        return "";
      },
    });

    expect(result).toBe("abc123");
    expect(commands.map((command) => command.args)).toEqual([
      [
        "git",
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--no-tags",
        "https://github.com/example/private-fixtures.git",
        "/tmp/fixtures/repo",
      ],
      ["git", "rev-parse", "HEAD"],
      ["git", "fetch", "--depth", "1", "origin", "abc123"],
      ["git", "checkout", "FETCH_HEAD"],
      ["git", "rev-parse", "HEAD"],
    ]);
    expect(commands.every((command) => command.env === gitEnv)).toBe(true);
    expect(
      commands
        .slice(1)
        .every((command) => command.cwd === "/tmp/fixtures/repo"),
    ).toBe(true);
    expect(heartbeats).toEqual([{ phase: "clone" }, { phase: "fetch-pin" }]);
  });

  it("does not fetch when the requested pin is already checked out", async () => {
    const commands: FixtureGitCommand[] = [];
    const heartbeats: { phase: "clone" | "fetch-pin" }[] = [];
    const result = await checkoutFixtureRepo({
      fixturesRepoUrl: "https://github.com/example/private-fixtures.git",
      repoDir: "/tmp/fixtures/repo",
      pin: "initial-sha",
      gitEnv,
      heartbeat: (event) => {
        heartbeats.push(event);
      },
      runGit: async (command) => {
        commands.push(command);
        return command.args.join(" ") === "git rev-parse HEAD"
          ? "initial-sha\n"
          : "";
      },
    });

    expect(result).toBe("initial-sha");
    expect(commands.map((command) => command.args[1])).toEqual([
      "clone",
      "rev-parse",
    ]);
    expect(heartbeats).toEqual([{ phase: "clone" }]);
  });
});

describe("runFixtureGitCommand", () => {
  it("redacts the token from git stderr on failure", async () => {
    await expect(
      runFixtureGitCommand({
        args: [
          "bun",
          "--eval",
          "console.error('token secret-token leaked'); process.exit(7)",
        ],
        env: gitEnv,
      }),
    ).rejects.toThrow("token [redacted] leaked");
  });
});
