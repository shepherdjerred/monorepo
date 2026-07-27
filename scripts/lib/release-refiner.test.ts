import { describe, expect, test } from "bun:test";

import {
  isClaudeQuotaExhaustion,
  runReleaseRefiner,
  type RefinerCommandRunner,
} from "./release-refiner.ts";
import type { RunResult } from "./run.ts";

const refinedEnvelope =
  '<!-- release-refiner-result -->\n{"status":"refined","prNumber":1720,"packagesRefined":["webring"],"commitSha":"0123456789abcdef0123456789abcdef01234567"}\n<!-- /release-refiner-result -->';

const claudeSuccess: RunResult = {
  stdout: JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: refinedEnvelope,
  }),
  stderr: "",
  exitCode: 0,
};
const codexSuccess: RunResult = {
  stdout: refinedEnvelope,
  stderr: "",
  exitCode: 0,
};
const quota: RunResult = {
  stdout: JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    api_error_status: 429,
    result: "You've hit your weekly limit · resets Jul 30, 12am (UTC)",
  }),
  stderr: "",
  exitCode: 1,
};

type RecordedCall = {
  command: string[];
  env: Record<string, string>;
  unsetEnv: string[];
};

function runner(
  results: RunResult[],
  calls: RecordedCall[],
): RefinerCommandRunner {
  return (command, options) => {
    calls.push({
      command,
      env: options.env ?? {},
      unsetEnv: options.unsetEnv ?? [],
    });
    const result = results.shift();
    if (result === undefined) {
      throw new Error("test runner received an unexpected command");
    }
    return Promise.resolve(result);
  };
}

function input(execute: RefinerCommandRunner) {
  return {
    root: "/workspace",
    prompt: "refine the release notes",
    env: { GH_TOKEN: "github-token", GIT_ASKPASS: "/tmp/askpass" },
    claudeToken: "claude-token",
    openAiApiKey: "openai-key",
    execute,
  };
}

describe("release refiner provider selection", () => {
  test("uses Claude when the primary refiner succeeds", async () => {
    const calls: RecordedCall[] = [];
    const provider = await runReleaseRefiner(
      input(runner([claudeSuccess], calls)),
    );

    expect(provider).toBe("claude");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command[0]).toBe("claude");
    expect(calls[0]?.env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("claude-token");
    expect(calls[0]?.env["CODEX_API_KEY"]).toBeUndefined();
    expect(calls[0]?.unsetEnv).toEqual([
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "CODEX_ID_TOKEN",
      "CODEX_ACCOUNT_ID",
      "ANTHROPIC_API_KEY",
    ]);
  });

  test("falls back to Codex only for a validated Claude usage quota", async () => {
    const calls: RecordedCall[] = [];
    const provider = await runReleaseRefiner(
      input(runner([quota, codexSuccess], calls)),
    );

    expect(provider).toBe("codex");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.command.slice(0, 7)).toEqual([
      "bun",
      "--no-install",
      "run",
      "--cwd",
      "scripts",
      "release-refiner:codex",
      "--",
    ]);
    expect(calls[1]?.command).toContain("gpt-5.6-sol");
    expect(calls[1]?.command).toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(calls[1]?.command).toContain("--ephemeral");
    expect(calls[1]?.command).toContain("--skip-git-repo-check");
    expect(calls[1]?.env["CODEX_API_KEY"]).toBe("openai-key");
    expect(calls[1]?.env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
    expect(calls[1]?.unsetEnv).toEqual([
      "OPENAI_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "CODEX_ID_TOKEN",
      "CODEX_ACCOUNT_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ]);
  });

  test("does not treat an arbitrary 429 as usage exhaustion", () => {
    expect(
      isClaudeQuotaExhaustion({
        stdout: JSON.stringify({
          is_error: true,
          api_error_status: 429,
          result: "Requests are temporarily rate limited",
        }),
        stderr: "",
        exitCode: 1,
      }),
    ).toBe(false);
  });

  test("fails closed on a malformed zero-exit Claude result", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [{ stdout: "not-json", stderr: "", exitCode: 0 }],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "without a valid non-error JSON result",
    );
    expect(calls).toHaveLength(1);
  });

  test("fails closed when Claude exits zero with a hard-failure envelope", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [
        {
          stdout: JSON.stringify({
            is_error: false,
            result:
              '<!-- release-refiner-result -->{"status":"hard-failure-missing-gh"}<!-- /release-refiner-result -->',
          }),
          stderr: "",
          exitCode: 0,
        },
      ],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "Claude release refiner exited 0 without a valid success envelope",
    );
    expect(calls).toHaveLength(1);
  });

  test("fails closed on malformed or unknown Claude errors", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [{ stdout: "not-json", stderr: "authentication failed", exitCode: 1 }],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "Claude release refiner failed",
    );
    expect(calls).toHaveLength(1);
  });

  test("fails closed when the Codex fallback fails", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [
        quota,
        {
          stdout: "",
          stderr: "OpenAI quota unavailable",
          exitCode: 1,
        },
      ],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "Codex release refiner failed",
    );
    expect(calls).toHaveLength(2);
  });

  test("fails closed when Codex exits zero with a hard-failure envelope", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [
        quota,
        {
          stdout:
            '<!-- release-refiner-result -->{"status":"hard-failure-missing-gh","error":"gh missing"}<!-- /release-refiner-result -->',
          stderr: "",
          exitCode: 0,
        },
      ],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "Codex release refiner exited 0 without a valid success envelope",
    );
    expect(calls).toHaveLength(2);
  });

  test("fails closed when Codex exits zero without a result envelope", async () => {
    const calls: RecordedCall[] = [];
    const execute = runner(
      [
        quota,
        {
          stdout: "Done: release notes could not be refined",
          stderr: "",
          exitCode: 0,
        },
      ],
      calls,
    );

    await expect(runReleaseRefiner(input(execute))).rejects.toThrow(
      "Codex release refiner exited 0 without a valid success envelope",
    );
    expect(calls).toHaveLength(2);
  });
});
