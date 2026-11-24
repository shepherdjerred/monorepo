import { describe, expect, test, vi } from "vitest";
import { GUI_DELEGATED_ENVIRONMENT } from "#lib/credential-gui-bridge.ts";
import {
  populateGitSpiceEnvironment,
  type CommandRunner,
} from "#lib/git-spice/env.ts";

describe("populateGitSpiceEnvironment (AI-434)", () => {
  test("preserves an existing GITHUB_TOKEN without invoking gh", async () => {
    const run = vi.fn<CommandRunner>();
    const env = await populateGitSpiceEnvironment(
      ["branch", "submit"],
      { GITHUB_TOKEN: "existing-token", GH_TOKEN: "other-token" },
      { run },
    );
    expect(env["GITHUB_TOKEN"]).toBe("existing-token");
    expect(run).not.toHaveBeenCalled();
  });

  test("skips injection when --github-token is passed on argv", async () => {
    const run = vi.fn<CommandRunner>();
    for (const args of [
      ["--github-token", "cli-token", "branch", "submit"],
      ["--github-token=cli-token", "branch", "submit"],
    ]) {
      const env = await populateGitSpiceEnvironment(
        args,
        { GH_TOKEN: "ambient-gh" },
        { run },
      );
      expect(env["GITHUB_TOKEN"]).toBeUndefined();
    }
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    [["--help"]],
    [["-h"]],
    [["--version"]],
    [["version"]],
    [["shell", "completion"]],
    [["auth", "login"]],
    [["auth", "status"]],
    [["auth", "logout"]],
    [["--no-prompt", "auth", "login"]],
    [["branch", "submit", "--help"]],
  ])(
    "never injects GITHUB_TOKEN for metadata/shell/auth invocation %j",
    async (args) => {
      const run = vi.fn<CommandRunner>();
      const env = await populateGitSpiceEnvironment(
        args,
        { GH_TOKEN: "ambient-gh-token" },
        { run },
      );
      expect(env["GITHUB_TOKEN"]).toBeUndefined();
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("copies trimmed GH_TOKEN into GITHUB_TOKEN without shelling out", async () => {
    const run = vi.fn<CommandRunner>();
    const env = await populateGitSpiceEnvironment(
      ["branch", "submit", "--draft"],
      { GH_TOKEN: "  ghs_ambient_secret  " },
      { run },
    );
    expect(env["GITHUB_TOKEN"]).toBe("ghs_ambient_secret");
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    [["branch", "create", "my-feat"]],
    [["log", "short"]],
    [["branch", "restack"]],
    [["up"]],
  ])(
    "does not shell out to gh auth token for local subcommand %j",
    async (args) => {
      const run = vi.fn<CommandRunner>();
      const env = await populateGitSpiceEnvironment(args, {}, { run });
      expect(env["GITHUB_TOKEN"]).toBeUndefined();
      expect(run).not.toHaveBeenCalled();
    },
  );

  test.each([
    [["branch", "submit"]],
    [["bs"]],
    [["ss"]],
    [["uss"]],
    [["dss"]],
    [["branch", "merge"]],
    [["bm"]],
    [["sm"]],
    [["dsm"]],
    [["repo", "sync"]],
    [["rs"]],
    [["repo", "s"]],
    [["r", "s"]],
    [["repo", "init"]],
    [["ri"]],
    [["review", "list"]],
    [["--no-prompt", "-C", "/tmp/worktree", "bs", "--draft"]],
  ])("resolves gh auth token for forge subcommand %j", async (args) => {
    const run = vi.fn<CommandRunner>(async (argv) => {
      expect(argv).toEqual(["/usr/local/bin/gh", "auth", "token"]);
      return { exit: 0, stdout: "gho_from_keyring\n", stderr: "" };
    });

    const env = await populateGitSpiceEnvironment(
      args,
      {},
      { run, ghExecutable: "/usr/local/bin/gh", platform: "linux" },
    );
    expect(env["GITHUB_TOKEN"]).toBe("gho_from_keyring");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("falls back to macOS herdr-core GUI bridge in non-GUI launchd sessions", async () => {
    const calls: string[][] = [];
    const run = vi.fn<CommandRunner>(async (argv) => {
      calls.push(argv);
      if (argv[0] === "/opt/homebrew/bin/gh") {
        return { exit: 1, stdout: "", stderr: "not logged in" };
      }
      if (argv[0] === "security" && argv[1] === "list-keychains") {
        return {
          exit: 0,
          stdout: '    "/Library/Keychains/System.keychain"\n',
          stderr: "",
        };
      }
      if (argv[0] === "launchctl" && argv[1] === "managername") {
        return { exit: 0, stdout: "Background\n", stderr: "" };
      }
      if (
        argv[0] === "/Users/test/.local/bin/herdr-core" &&
        argv[1] === "server"
      ) {
        return { exit: 0, stdout: '{"running":true}', stderr: "" };
      }
      if (
        argv[0] === "/Users/test/.local/bin/herdr-core" &&
        argv[1] === "exec"
      ) {
        return { exit: 0, stdout: "gho_gui_delegated_token\n", stderr: "" };
      }
      throw new Error(`Unexpected command: ${argv.join(" ")}`);
    });

    const env = await populateGitSpiceEnvironment(
      ["bs"],
      { GH_CONFIG_DIR: "/Users/test/.config/gh-agent" },
      {
        platform: "darwin",
        run,
        ghExecutable: "/opt/homebrew/bin/gh",
        herdrCorePath: "/Users/test/.local/bin/herdr-core",
      },
    );

    expect(env["GITHUB_TOKEN"]).toBe("gho_gui_delegated_token");
    expect(calls.at(-1)).toEqual([
      "/Users/test/.local/bin/herdr-core",
      "exec",
      "--env",
      `${GUI_DELEGATED_ENVIRONMENT}=1`,
      "--env",
      "GH_CONFIG_DIR=/Users/test/.config/gh-agent",
      "/opt/homebrew/bin/gh",
      "auth",
      "token",
    ]);
  });

  test("does not recurse into herdr-core when already GUI-delegated", async () => {
    const run = vi.fn<CommandRunner>(async () => ({
      exit: 1,
      stdout: "",
      stderr: "not logged in",
    }));

    const env = await populateGitSpiceEnvironment(
      ["rs"],
      { [GUI_DELEGATED_ENVIRONMENT]: "1" },
      {
        platform: "darwin",
        run,
        ghExecutable: "/opt/homebrew/bin/gh",
        herdrCorePath: "/Users/test/.local/bin/herdr-core",
      },
    );
    expect(env["GITHUB_TOKEN"]).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
