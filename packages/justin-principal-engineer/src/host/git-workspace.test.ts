import { describe, expect, test } from "vitest";

import type { Config } from "#src/domain/schemas.ts";
import { branchName, GitWorkspace } from "#src/host/git-workspace.ts";
import type { CommandResult, CommandRunner } from "#src/runtime/process.ts";

function result(stdout = ""): CommandResult {
  return { exitCode: 0, stdout, stderr: "", timedOut: false };
}

const config: Config = {
  repository: {
    stableCheckout: "/tmp/stable",
    slug: "example/repo",
    baseBranch: "main",
  },
  linear: { team: "SJ", apiKey: "op://test/linear/key" },
  woodpecker: { apiToken: "op://test/woodpecker/key" },
  pinchtab: { configPath: "/tmp/pinchtab.json" },
  github: {
    appId: "op://vault/app/id",
    installationId: "op://vault/app/installation",
    privateKey: "op://vault/app/key",
    approverLogin: "owner",
    approverId: 1,
    botLogin: "bot[bot]",
  },
  agents: {
    codex: {
      openRouterApiKey: "op://vault/codex/key",
      model: "codex",
    },
  },
  docker: {
    image: "example/image@sha256:digest",
    platform: "linux/amd64",
    turnTimeoutMinutes: 45,
  },
};

describe("branchName", () => {
  test("creates a bounded task branch", () => {
    expect(branchName("SJ-42", "Move the Scout button 2px!")).toBe(
      "agent/sj-42-move-the-scout-button-2px",
    );
  });
});

describe("GitWorkspace conflict publication", () => {
  test("stages repairs and continues the interrupted Git-Spice rebase", async () => {
    const commands: string[][] = [];
    const run: CommandRunner = (command) => {
      commands.push([...command]);
      if (command.includes("--cached")) return Promise.resolve(result());
      if (command.includes("--others")) return Promise.resolve(result());
      return command.includes("--name-only")
        ? Promise.resolve(result("src/fixed.ts\0"))
        : Promise.resolve(result());
    };
    const workspace = new GitWorkspace(config, run);
    await workspace.continueRestackAndSubmit({
      checkout: "/tmp/task",
      githubEnv: { GH_TOKEN: "token" },
    });
    expect(commands).toContainEqual(["git", "add", "--", "src/fixed.ts"]);
    expect(commands).toContainEqual([
      "toolkit",
      "git-spice",
      "rebase",
      "continue",
      "--no-edit",
      "--no-prompt",
    ]);
    expect(commands.at(-1)).toContain("submit");
  });
});
