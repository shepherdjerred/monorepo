import { describe, expect, test } from "bun:test";

import {
  isClaudeQuotaExhaustion,
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
    expect(received.codexAccessToken).toBe("codex-credential");
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
    codexAccessToken: "codex-credential",
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
