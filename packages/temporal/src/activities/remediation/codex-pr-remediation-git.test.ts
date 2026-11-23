import { describe, expect, test } from "vitest";
import { captureCommand } from "#activities/command-runner.ts";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
import {
  configureRemediationPrAutoMerge,
  enforceAllowedPaths,
  formatAndFilterAllowedFiles,
  remediationAgentEnv,
  remediationDenyReadPaths,
} from "./codex-pr-remediation-git.ts";
import {
  extractMarkdownHttpUrls,
  newlyIntroducedMarkdownHttpUrls,
} from "./http-url-check.ts";
import { createRemediationTestGitRepo } from "./remediation-test-git.ts";

function createGitHelperRepo() {
  return createRemediationTestGitRepo({
    prefix: "remediation-git-test-",
    repoSubdir: "monorepo",
    files: {
      "README.md": "# Hello\nOld link\n",
      "AGENTS.md": "# Agents\nDo not touch\n",
    },
  });
}

describe("remediationAgentEnv and remediationDenyReadPaths", () => {
  test("allowlists safe runtime keys while stripping provider, CI, flag, GitHub, Postal, S3, and Temporal secrets", () => {
    const env = remediationAgentEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      OPENAI_API_KEY: "dummy-openai-value",
      GH_TOKEN: "dummy-gh",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "dummy-pem",
      POSTAL_API_KEY: "dummy-postal",
      AWS_ACCESS_KEY_ID: "dummy-aws-id",
      AWS_SECRET_ACCESS_KEY: "dummy-aws",
      S3_ENDPOINT: "https://s3.internal",
      REPORT_HUB_INGEST_TOKEN: "dummy-hub",
      TEMPORAL_API_KEY: "dummy-temporal",
      ANTHROPIC_API_KEY: "dummy-anthropic",
      WOODPECKER_TOKEN: "dummy-woodpecker",
      FLAGS_MACHINE_TOKEN: "dummy-flags",
      DOCKERHUB_READ_CONFIG_JSON: '{"auths":{}}',
    });

    expect(env["OPENAI_API_KEY"]).toBeUndefined();
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["HOME"]).toBe("/tmp/home");
    expect(env["GH_TOKEN"]).toBeUndefined();
    expect(env["GITHUB_APP_ID"]).toBeUndefined();
    expect(env["GITHUB_APP_PRIVATE_KEY"]).toBeUndefined();
    expect(env["POSTAL_API_KEY"]).toBeUndefined();
    expect(env["AWS_ACCESS_KEY_ID"]).toBeUndefined();
    expect(env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    expect(env["S3_ENDPOINT"]).toBeUndefined();
    expect(env["REPORT_HUB_INGEST_TOKEN"]).toBeUndefined();
    expect(env["TEMPORAL_API_KEY"]).toBeUndefined();
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["WOODPECKER_TOKEN"]).toBeUndefined();
    expect(env["FLAGS_MACHINE_TOKEN"]).toBeUndefined();
    expect(env["DOCKERHUB_READ_CONFIG_JSON"]).toBeUndefined();
  });

  test("denies secret mounts and container/worker procfs paths", () => {
    const denied = remediationDenyReadPaths(4242);
    expect(denied).toContain("/run/secrets");
    expect(denied).toContain("/var/run/secrets");
    expect(denied).toContain("/etc/freshrss");
    expect(denied).toContain("/proc/1");
    expect(denied).toContain("/proc/4242");
  });
});

describe("formatAndFilterAllowedFiles environment isolation", () => {
  test("sanitizes subprocess env across both initial prettier and formatting-only baseline comparison", async () => {
    const repo = await createGitHelperRepo();
    try {
      await Bun.write(
        `${repo.repoDir}/node_modules/.bin/prettier`,
        "#!/bin/sh\nexit 0\n",
      );
      await Bun.write(`${repo.repoDir}/README.md`, "# Hello\nUpdated link\n");

      const prettierEnvs: Record<string, string | undefined>[] = [];
      await formatAndFilterAllowedFiles({
        repoDir: repo.repoDir,
        changedFiles: ["README.md"],
        formatFiles: true,
        sourceEnv: {
          PATH: Bun.env["PATH"],
          HOME: Bun.env["HOME"],
          OPENAI_API_KEY: "dummy-openai-secret",
          FLAGS_MACHINE_TOKEN: "dummy-flags-secret",
          WOODPECKER_TOKEN: "dummy-woodpecker-secret",
        },
        commandRunner: (command, options) => {
          if (command[0] === "bunx" && command[2] === "prettier") {
            prettierEnvs.push({ ...options.env });
            return Promise.resolve("");
          }
          return runCommand(command, options);
        },
      });

      expect(prettierEnvs).toHaveLength(2);
      for (const env of prettierEnvs) {
        expect("OPENAI_API_KEY" in env).toBe(true);
        expect(env["OPENAI_API_KEY"]).toBeUndefined();
        expect("FLAGS_MACHINE_TOKEN" in env).toBe(true);
        expect(env["FLAGS_MACHINE_TOKEN"]).toBeUndefined();
        expect("WOODPECKER_TOKEN" in env).toBe(true);
        expect(env["WOODPECKER_TOKEN"]).toBeUndefined();
      }
    } finally {
      await repo.cleanup();
    }
  });
});

describe("captureCommand cancellation", () => {
  test("kills a running subprocess and rejects when signal aborts", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error("activity canceled"));
    }, 50);

    try {
      await expect(
        captureCommand(["sleep", "30"], {
          cwd: "/tmp",
          signal: controller.signal,
        }),
      ).rejects.toThrow("activity canceled");
    } finally {
      clearTimeout(timer);
    }
  });
});

describe("extractMarkdownHttpUrls and newlyIntroducedMarkdownHttpUrls", () => {
  test("extracts newly added or rewritten URLs including balanced parens while ignoring unchanged links", () => {
    const before = [
      "Existing [blocked](https://vendor.example/unchanged).",
      "Broken [old](https://example.org/dead).",
    ].join("\n");
    const after = [
      "Existing [blocked](https://vendor.example/unchanged).",
      "Fixed [wiki](https://en.wikipedia.org/wiki/League_of_Legends_(video_game)).",
      "Angle <https://docs.example.org/new-guide>.",
    ].join("\n");

    expect(extractMarkdownHttpUrls(after)).toEqual([
      "https://vendor.example/unchanged",
      "https://en.wikipedia.org/wiki/League_of_Legends_(video_game)",
      "https://docs.example.org/new-guide",
    ]);
    expect(newlyIntroducedMarkdownHttpUrls(before, after)).toEqual([
      "https://en.wikipedia.org/wiki/League_of_Legends_(video_game)",
      "https://docs.example.org/new-guide",
    ]);
  });
});

describe("configureRemediationPrAutoMerge", () => {
  test("catches gh pr merge --auto failure cleanly and returns false", async () => {
    const enabled = await configureRemediationPrAutoMerge({
      repoDir: "/tmp",
      repoSlug: "shepherdjerred/monorepo",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/9",
      ghToken: "dummy-github",
      autoMerge: true,
      commandRunner: () => Promise.reject(new Error("auto-merge not allowed")),
    });
    expect(enabled).toBe(false);
  });

  test("disables previously armed auto-merge and confirms disabled state when autoMerge is false", async () => {
    const calls: string[][] = [];
    let viewCalls = 0;
    const enabled = await configureRemediationPrAutoMerge({
      repoDir: "/tmp",
      repoSlug: "shepherdjerred/monorepo",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/10",
      ghToken: "dummy-github",
      autoMerge: false,
      commandRunner: (command) => {
        calls.push(command);
        if (command[1] === "pr" && command[2] === "view") {
          viewCalls += 1;
          return Promise.resolve(viewCalls === 1 ? "true" : "false");
        }
        return Promise.resolve("");
      },
    });
    expect(enabled).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("--disable-auto");
  });

  test("throws when disabling auto-merge fails or leaves auto-merge armed on a review-only PR", async () => {
    await expect(
      configureRemediationPrAutoMerge({
        repoDir: "/tmp",
        repoSlug: "shepherdjerred/monorepo",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/11",
        ghToken: "dummy-github",
        autoMerge: false,
        commandRunner: (command) =>
          command[1] === "pr" && command[2] === "view"
            ? Promise.resolve("true")
            : Promise.resolve(""),
      }),
    ).rejects.toThrow("Auto-merge remained enabled");
  });
});

describe("enforceAllowedPaths baseSha guard", () => {
  test("resets committed out-of-scope agent edits back to baseSha", async () => {
    const repo = await createGitHelperRepo();
    try {
      const baseSha = await runCommand(["git", "rev-parse", "HEAD"], {
        cwd: repo.repoDir,
      });
      await Bun.write(`${repo.repoDir}/AGENTS.md`, "# Pwned\n");
      await runCommand(["git", "add", "AGENTS.md"], { cwd: repo.repoDir });
      await runCommand(["git", "commit", "-m", "sneaky commit"], {
        cwd: repo.repoDir,
      });
      await Bun.write(`${repo.repoDir}/README.md`, "# Hello\nAllowed fix\n");

      const enforced = await enforceAllowedPaths({
        repoDir: repo.repoDir,
        baseSha,
        isAllowedPath: (path) => path === "README.md",
      });

      expect(enforced.allowedFiles).toEqual(["README.md"]);
      expect(enforced.revertedFiles).toContain("AGENTS.md");
      expect(
        await runCommand(["git", "rev-parse", "HEAD"], { cwd: repo.repoDir }),
      ).toBe(baseSha);
      expect(await Bun.file(`${repo.repoDir}/AGENTS.md`).text()).toBe(
        "# Agents\nDo not touch\n",
      );
    } finally {
      await repo.cleanup();
    }
  });
});
