import { describe, expect, test } from "vitest";

import {
  isClaudeQuotaExhaustion,
  isClaudeQuotaExhaustionError,
  refinerSdkEnv,
  runReleaseRefiner,
  type RefinerCommandRunner,
  type ReleaseAgentOutcome,
  type RunReleaseRefinerInput,
} from "./release-refiner.ts";
import type { RunResult } from "./run.ts";

const refinedCommitSha = "0123456789abcdef0123456789abcdef01234567";
const refinedEnvelope = `<!-- release-refiner-result -->\n{"status":"refined","prNumber":1720,"packagesRefined":["webring"],"commitSha":"${refinedCommitSha}"}\n<!-- /release-refiner-result -->`;
const noOpenReleasePrEnvelope =
  '<!-- release-refiner-result -->{"status":"no-open-release-pr"}<!-- /release-refiner-result -->';
const pendingReleasePrList: RunResult = {
  stdout: JSON.stringify([{ number: 1720 }]),
  stderr: "",
  exitCode: 0,
};
const noOpenReleasePrList: RunResult = {
  stdout: "[]",
  stderr: "",
  exitCode: 0,
};
const releasePr: RunResult = {
  stdout: JSON.stringify({
    number: 1720,
    state: "OPEN",
    baseRefName: "main",
    headRefName: "release-please--branches--main",
    headRefOid: refinedCommitSha,
    labels: [{ name: "autorelease: pending" }],
    body: [
      ":robot: Release notes hand-refined",
      "<details><summary>webring: 2.0.0</summary>",
    ].join("\n"),
  }),
  stderr: "",
  exitCode: 0,
};
const refinerCommit: RunResult = {
  stdout: JSON.stringify({
    sha: refinedCommitSha,
    commit: {
      author: {
        name: "release-please-refiner[bot]",
        email: "release-please-refiner@users.noreply.github.com",
      },
      message: "chore(root): refine release notes for 2026-07-27",
    },
    files: [{ filename: "packages/webring/CHANGELOG.md" }],
  }),
  stderr: "",
  exitCode: 0,
};

type RecordedCall = {
  command: string[];
  env: Record<string, string>;
  unsetEnv: string[];
};
type AgentStep =
  | { provider: "claude" | "codex"; outcome: ReleaseAgentOutcome }
  | { provider: "claude" | "codex"; error: Error };
type HarnessInput = {
  agentSteps?: AgentStep[];
  commandResults?: RunResult[];
  preflight?: RunResult;
};

function completed(output: string): ReleaseAgentOutcome {
  return { kind: "completed", output };
}

function harness(options: HarnessInput = {}): {
  input: RunReleaseRefinerInput;
  calls: RecordedCall[];
  agentProviders: ("claude" | "codex")[];
} {
  const calls: RecordedCall[] = [];
  const commandResults = [...(options.commandResults ?? [])];
  const agentSteps = [...(options.agentSteps ?? [])];
  const agentProviders: ("claude" | "codex")[] = [];
  let preflightHandled = false;
  const execute: RefinerCommandRunner = (command, runOptions) => {
    calls.push({
      command,
      env: runOptions.env ?? {},
      unsetEnv: runOptions.unsetEnv ?? [],
    });
    if (!preflightHandled) {
      preflightHandled = true;
      return Promise.resolve(options.preflight ?? pendingReleasePrList);
    }
    const result = commandResults.shift();
    if (result === undefined) {
      throw new Error("test runner received an unexpected command");
    }
    return Promise.resolve(result);
  };
  const runAgent = (
    provider: "claude" | "codex",
    received: RunReleaseRefinerInput,
  ): Promise<ReleaseAgentOutcome> => {
    expect(received.claudeToken).toBe("claude-token");
    expect(received.codexHome).toBe("/buildkite/codex-auth");
    agentProviders.push(provider);
    const step = agentSteps.shift();
    if (step?.provider !== provider) {
      throw new Error(`unexpected ${provider} SDK invocation`);
    }
    if ("error" in step) throw step.error;
    return Promise.resolve(step.outcome);
  };
  const input: RunReleaseRefinerInput = {
    root: "/workspace",
    prompt: "refine the release notes",
    env: { GH_TOKEN: "github-token", GIT_ASKPASS: "/tmp/askpass" },
    claudeToken: "claude-token",
    codexHome: "/buildkite/codex-auth",
    execute,
    runClaude: (received) => runAgent("claude", received),
    runCodex: (received) => runAgent("codex", received),
  };
  return { input, calls, agentProviders };
}

describe("release refiner provider selection", () => {
  test("skips both SDKs when release-please produced no pending PR", async () => {
    const testHarness = harness({ preflight: noOpenReleasePrList });

    expect(await runReleaseRefiner(testHarness.input)).toBe("none");
    expect(testHarness.agentProviders).toEqual([]);
    expect(testHarness.calls).toHaveLength(1);
    expect(testHarness.calls[0]?.command).toEqual([
      "gh",
      "pr",
      "list",
      "--repo",
      "shepherdjerred/monorepo",
      "--base",
      "main",
      "--label",
      "autorelease: pending",
      "--state",
      "open",
      "--json",
      "number",
      "--limit",
      "1",
    ]);
  });

  test("uses Claude Agent SDK when the primary refiner succeeds", async () => {
    const testHarness = harness({
      agentSteps: [{ provider: "claude", outcome: completed(refinedEnvelope) }],
      commandResults: [releasePr, refinerCommit],
    });

    expect(await runReleaseRefiner(testHarness.input)).toBe("claude");
    expect(testHarness.agentProviders).toEqual(["claude"]);
    expect(testHarness.calls.map((call) => call.command[0])).toEqual([
      "gh",
      "gh",
      "gh",
    ]);
    expect(testHarness.calls[1]?.command.slice(0, 3)).toEqual([
      "gh",
      "pr",
      "view",
    ]);
  });

  test("falls back to Codex SDK only for validated Claude quota", async () => {
    const testHarness = harness({
      agentSteps: [
        {
          provider: "claude",
          outcome: {
            kind: "quota-exhausted",
            detail: "You've hit your weekly limit",
          },
        },
        { provider: "codex", outcome: completed(refinedEnvelope) },
      ],
      commandResults: [releasePr, refinerCommit],
    });

    expect(await runReleaseRefiner(testHarness.input)).toBe("codex");
    expect(testHarness.agentProviders).toEqual(["claude", "codex"]);
    expect(testHarness.calls.every((call) => call.command[0] === "gh")).toBe(
      true,
    );
  });

  test("independently verifies a no-open-release-pr result", async () => {
    const testHarness = harness({
      agentSteps: [
        { provider: "claude", outcome: completed(noOpenReleasePrEnvelope) },
      ],
      commandResults: [noOpenReleasePrList],
    });

    expect(await runReleaseRefiner(testHarness.input)).toBe("claude");
    expect(testHarness.calls).toHaveLength(2);
    expect(testHarness.calls[1]?.command.slice(0, 3)).toEqual([
      "gh",
      "pr",
      "list",
    ]);
  });
});

describe("release refiner remote verification", () => {
  test("rejects a no-open result when GitHub has a pending release PR", async () => {
    const testHarness = harness({
      agentSteps: [
        { provider: "claude", outcome: completed(noOpenReleasePrEnvelope) },
      ],
      commandResults: [pendingReleasePrList],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "reported no open release PR, but GitHub has one",
    );
  });

  test("rejects a refined result that does not match the release PR head", async () => {
    const testHarness = harness({
      agentSteps: [{ provider: "claude", outcome: completed(refinedEnvelope) }],
      commandResults: [
        {
          ...releasePr,
          stdout: JSON.stringify({
            number: 1720,
            state: "OPEN",
            baseRefName: "main",
            headRefName: "release-please--branches--main",
            headRefOid: "abcdef0123456789abcdef0123456789abcdef01",
            labels: [{ name: "autorelease: pending" }],
            body: "<details><summary>webring: 2.0.0</summary>",
          }),
        },
      ],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "does not match the open pending release PR head",
    );
  });

  test("rejects a refined result whose remote commit changed other files", async () => {
    const testHarness = harness({
      agentSteps: [{ provider: "claude", outcome: completed(refinedEnvelope) }],
      commandResults: [
        releasePr,
        {
          ...refinerCommit,
          stdout: JSON.stringify({
            sha: refinedCommitSha,
            commit: {
              author: {
                name: "release-please-refiner[bot]",
                email: "release-please-refiner@users.noreply.github.com",
              },
              message: "chore(root): refine release notes for 2026-07-27",
            },
            files: [{ filename: "scripts/release.ts" }],
          }),
        },
      ],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "does not match the remote refiner commit and PR body",
    );
  });
});

describe("release refiner failure handling", () => {
  test("recognizes only a parsed 429 usage-limit result", () => {
    expect(
      isClaudeQuotaExhaustion({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your weekly limit · resets Jul 30, 12am (UTC)",
      }),
    ).toBe(true);
    expect(
      isClaudeQuotaExhaustion({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
        errors: ["Requests are temporarily rate limited"],
      }),
    ).toBe(false);
    expect(isClaudeQuotaExhaustion("not-json")).toBe(false);
  });

  test("recognizes the session limit, not only the weekly one", () => {
    expect(
      isClaudeQuotaExhaustion({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your session limit · resets 8:50pm (UTC)",
      }),
    ).toBe(true);
  });

  test("recognizes quota the Agent SDK throws instead of yielding", () => {
    // Verbatim from build 11045, where this ended the lane instead of falling
    // back to Codex.
    expect(
      isClaudeQuotaExhaustionError(
        new Error(
          "Claude Code returned an error result: You've hit your session limit · resets 8:50pm (UTC)",
        ),
      ),
    ).toBe(true);
  });

  test("re-raises every thrown error that is not validated quota", () => {
    // Claude Code's verdict, but not a quota one.
    expect(
      isClaudeQuotaExhaustionError(
        new Error(
          "Claude Code returned an error result: tool execution failed",
        ),
      ),
    ).toBe(false);
    // A quota phrase with no Claude Code envelope — e.g. a CHANGELOG line or a
    // tool's own output quoting one. Not Claude Code saying it is out of quota.
    expect(
      isClaudeQuotaExhaustionError(
        new Error("git push failed: You've hit your session limit"),
      ),
    ).toBe(false);
    expect(
      isClaudeQuotaExhaustionError("Claude Code returned an error result"),
    ).toBe(false);
    expect(isClaudeQuotaExhaustionError(undefined)).toBe(false);
  });

  test("fails closed on malformed successful Claude output", async () => {
    const testHarness = harness({
      agentSteps: [{ provider: "claude", outcome: completed("not-json") }],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "without a valid success envelope",
    );
    expect(testHarness.agentProviders).toEqual(["claude"]);
  });

  test("does not fall back on unknown Claude SDK failures", async () => {
    const testHarness = harness({
      agentSteps: [
        { provider: "claude", error: new Error("authentication failed") },
      ],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "authentication failed",
    );
    expect(testHarness.agentProviders).toEqual(["claude"]);
  });

  test("fails closed when the Codex SDK fallback fails", async () => {
    const testHarness = harness({
      agentSteps: [
        {
          provider: "claude",
          outcome: { kind: "quota-exhausted", detail: "weekly limit" },
        },
        { provider: "codex", error: new Error("Codex quota unavailable") },
      ],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "Codex quota unavailable",
    );
    expect(testHarness.agentProviders).toEqual(["claude", "codex"]);
  });

  test("fails closed when Codex returns an invalid result envelope", async () => {
    const testHarness = harness({
      agentSteps: [
        {
          provider: "claude",
          outcome: { kind: "quota-exhausted", detail: "weekly limit" },
        },
        {
          provider: "codex",
          outcome: completed("Done: release notes could not be refined"),
        },
      ],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "Codex release refiner exited 0 without a valid success envelope",
    );
  });
});

describe("refinerSdkEnv", () => {
  const gitAuth = {
    env: {
      GH_TOKEN: "minted-token",
      GIT_ASKPASS: "/tmp/git-askpass.sh",
      GIT_TERMINAL_PROMPT: "0",
    },
  };

  test("withholds CI secrets the agent has no use for", () => {
    // The main-only release lane runs with GITHUB_APP_PRIVATE_KEY set because
    // setupGitAuth() needs it, and these agents have Bash plus network access.
    // The environment is an allowlist so a secret nobody enumerated cannot ride
    // along into a prompt-injectable agent.
    const environment = refinerSdkEnv(
      gitAuth,
      { CLAUDE_CODE_OAUTH_TOKEN: "claude-credential" },
      {
        PATH: "/usr/bin",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_INSTALLATION_ID: "67890",
        BUILDKITE_AGENT_ACCESS_TOKEN: "agent-token",
        AWS_SECRET_ACCESS_KEY: "seaweedfs-secret",
        SOME_FUTURE_CI_SECRET: "not-yet-invented",
      },
    );

    for (const withheld of [
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "BUILDKITE_AGENT_ACCESS_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "SOME_FUTURE_CI_SECRET",
    ]) {
      expect(environment[withheld]).toBeUndefined();
    }
    // Only the allowlisted process settings, the git auth, and this run's own
    // provider credential survive.
    expect(Object.keys(environment).toSorted()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "GH_TOKEN",
      "GIT_ASKPASS",
      "GIT_TERMINAL_PROMPT",
      "PATH",
    ]);
  });

  test("keeps the TLS and proxy settings an agent needs to reach its provider", () => {
    expect(
      refinerSdkEnv(
        gitAuth,
        {},
        {
          PATH: "/usr/bin",
          HOME: "/root",
          NODE_EXTRA_CA_CERTS: "/etc/ssl/ci.pem",
          HTTPS_PROXY: "http://proxy:3128",
          NO_PROXY: "localhost",
        },
      ),
    ).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/root",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/ci.pem",
      HTTPS_PROXY: "http://proxy:3128",
      NO_PROXY: "localhost",
    });
  });

  test("preserves the CI image PATH the SDK needs to spawn bun", () => {
    // Both SDKs replace the environment wholesale; without this the release
    // lane dies with an executable-not-found before refinement.
    expect(
      refinerSdkEnv(gitAuth, {}, { PATH: "/opt/mise/shims:/usr/bin" })["PATH"],
    ).toBe("/opt/mise/shims:/usr/bin");
  });

  test("layers git auth and the launched provider's credential on top", () => {
    expect(
      refinerSdkEnv(
        gitAuth,
        { CLAUDE_CODE_OAUTH_TOKEN: "claude-credential", IS_SANDBOX: "1" },
        { PATH: "/usr/bin", GH_TOKEN: "worker-token" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      GH_TOKEN: "minted-token",
      GIT_ASKPASS: "/tmp/git-askpass.sh",
      GIT_TERMINAL_PROMPT: "0",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-credential",
      IS_SANDBOX: "1",
    });
  });

  test("passes the isolated Codex auth home without an extracted token", () => {
    const environment = refinerSdkEnv(
      gitAuth,
      { CODEX_HOME: "/buildkite/codex-auth" },
      {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "anthropic-key",
        CLAUDE_CODE_OAUTH_TOKEN: "claude-credential",
        CODEX_ACCESS_TOKEN: "worker-codex-credential",
        CODEX_API_KEY: "codex-key",
        CODEX_ID_TOKEN: "codex-id",
        CODEX_REFRESH_TOKEN: "codex-refresh",
        OPENAI_API_KEY: "openai-key",
      },
    );

    expect(environment["CODEX_HOME"]).toBe("/buildkite/codex-auth");
    for (const stripped of [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CODEX_ACCESS_TOKEN",
      "CODEX_API_KEY",
      "CODEX_ID_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "OPENAI_API_KEY",
    ]) {
      expect(environment).not.toHaveProperty(stripped);
    }
  });
});
