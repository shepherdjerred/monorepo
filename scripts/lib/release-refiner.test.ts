import { afterEach, describe, expect, test, vi } from "vitest";
import { Thread } from "@openai/codex-sdk";

import {
  refinerSdkEnv,
  runReleaseRefiner,
  type RefinerCommandRunner,
  type ReleaseAgentOutcome,
  type RunReleaseRefinerInput,
} from "./release-refiner.ts";
import type { RunResult } from "./run.ts";

const refinedCommitSha = "0123456789abcdef0123456789abcdef01234567";
const refinedEnvelope = JSON.stringify({
  result: {
    status: "refined",
    prNumber: 1720,
    packagesRefined: ["webring"],
    commitSha: refinedCommitSha,
  },
});
const noOpenReleasePrEnvelope = '{"result":{"status":"no-open-release-pr"}}';

afterEach(() => vi.restoreAllMocks());

test("a human-ready release PR is frozen before invoking the refiner", async () => {
  const result = harness({
    preflight: {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify([{ number: 1720, isDraft: false }]),
    },
  });
  expect(await runReleaseRefiner(result.input)).toBe("deferred");
  expect(result.agentCalls).toBe(0);
  expect(result.calls).toHaveLength(1);
});
const pendingReleasePrList: RunResult = {
  stdout: JSON.stringify([{ number: 1720, isDraft: true }]),
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
      message: "chore(root): refine release notes for 2026-08-28",
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
type HarnessInput = {
  agentOutcome?: ReleaseAgentOutcome;
  agentError?: Error;
  commandResults?: RunResult[];
  preflight?: RunResult;
};

function harness(options: HarnessInput = {}): {
  input: RunReleaseRefinerInput;
  calls: RecordedCall[];
  agentCalls: number;
} {
  const calls: RecordedCall[] = [];
  const commandResults = [...(options.commandResults ?? [])];
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
  const state = { agentCalls: 0 };
  const input: RunReleaseRefinerInput = {
    root: "/workspace",
    prompt: "refine the release notes",
    env: { GH_TOKEN: "github-token", GIT_ASKPASS: "/tmp/askpass" },
    openAiApiKey: "openai-key",
    execute,
    runCodex: (received) => {
      expect(received.openAiApiKey).toBe("openai-key");
      state.agentCalls += 1;
      if (options.agentError !== undefined) throw options.agentError;
      return Promise.resolve(
        options.agentOutcome ?? { kind: "completed", output: refinedEnvelope },
      );
    },
  };
  return {
    input,
    calls,
    get agentCalls() {
      return state.agentCalls;
    },
  };
}

describe("release refiner provider selection", () => {
  test("constrains the native Codex response and still verifies GitHub", async () => {
    const run = vi.spyOn(Thread.prototype, "run").mockResolvedValue({
      items: [],
      finalResponse: refinedEnvelope,
      usage: null,
    });
    const testHarness = harness({ commandResults: [releasePr, refinerCommit] });
    delete testHarness.input.runCodex;

    expect(await runReleaseRefiner(testHarness.input)).toBe("codex");
    expect(run).toHaveBeenCalledWith(testHarness.input.prompt, {
      outputSchema: expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["result"],
        properties: {
          result: {
            anyOf: expect.arrayContaining([
              expect.objectContaining({
                additionalProperties: false,
                properties: expect.objectContaining({
                  commitSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
                  packagesRefined: expect.objectContaining({ minItems: 1 }),
                }),
              }),
            ]),
          },
        },
      }),
    });
    expect(testHarness.calls).toHaveLength(3);
  });

  test("skips inference when release-please produced no pending PR", async () => {
    const testHarness = harness({ preflight: noOpenReleasePrList });

    expect(await runReleaseRefiner(testHarness.input)).toBe("none");
    expect(testHarness.agentCalls).toBe(0);
    expect(testHarness.calls).toHaveLength(1);
  });

  test("uses only Codex SDK and independently verifies its result", async () => {
    const testHarness = harness({ commandResults: [releasePr, refinerCommit] });

    expect(await runReleaseRefiner(testHarness.input)).toBe("codex");
    expect(testHarness.agentCalls).toBe(1);
    expect(testHarness.calls.map((call) => call.command[0])).toEqual([
      "gh",
      "gh",
      "gh",
    ]);
    for (const call of testHarness.calls) {
      expect(call.unsetEnv).toContain("OPENAI_API_KEY");
      expect(call.unsetEnv).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    }
  });

  test("independently verifies a no-open-release-pr result", async () => {
    const testHarness = harness({
      agentOutcome: { kind: "completed", output: noOpenReleasePrEnvelope },
      commandResults: [noOpenReleasePrList],
    });

    expect(await runReleaseRefiner(testHarness.input)).toBe("codex");
    expect(testHarness.calls).toHaveLength(2);
  });
});

describe("release refiner failure handling", () => {
  test("fails closed without invoking another provider", async () => {
    const testHarness = harness({ agentError: new Error("provider failed") });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "provider failed",
    );
    expect(testHarness.agentCalls).toBe(1);
  });

  test("fails closed on an invalid result envelope", async () => {
    const testHarness = harness({
      agentOutcome: { kind: "completed", output: "not-json" },
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "Codex release refiner exited 0 without a valid success envelope",
    );
  });

  test.each([
    {
      name: "pipeline 6151's truncated SHA",
      commitSha: "be50cf9780aed0c2c058c6f46f5f935dbd9396d",
      packagesRefined: ["webring"],
    },
    {
      name: "empty package set",
      commitSha: refinedCommitSha,
      packagesRefined: [],
    },
    {
      name: "duplicate packages",
      commitSha: refinedCommitSha,
      packagesRefined: ["webring", "webring"],
    },
  ])(
    "rejects $name before accepting remote work",
    async ({ commitSha, packagesRefined }) => {
      const testHarness = harness({
        agentOutcome: {
          kind: "completed",
          output: JSON.stringify({
            result: {
              status: "refined",
              prNumber: 1720,
              commitSha,
              packagesRefined,
            },
          }),
        },
      });
      await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
        "without a valid success envelope",
      );
      expect(testHarness.calls).toHaveLength(1);
    },
  );
});

describe("release refiner remote verification", () => {
  test("rejects a no-open result when GitHub has a pending release PR", async () => {
    const testHarness = harness({
      agentOutcome: { kind: "completed", output: noOpenReleasePrEnvelope },
      commandResults: [pendingReleasePrList],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "reported no open release PR, but GitHub has one",
    );
  });

  test("rejects a result that does not match the release PR head", async () => {
    const mismatchedReleasePr = {
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
    };
    const testHarness = harness({ commandResults: [mismatchedReleasePr] });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "does not match the open pending release PR head",
    );
  });

  test("rejects a remote commit that changed another file", async () => {
    const mismatchedCommit = {
      ...refinerCommit,
      stdout: JSON.stringify({
        sha: refinedCommitSha,
        commit: {
          author: {
            name: "release-please-refiner[bot]",
            email: "release-please-refiner@users.noreply.github.com",
          },
          message: "chore(root): refine release notes for 2026-08-28",
        },
        files: [{ filename: "scripts/release/release.ts" }],
      }),
    };
    const testHarness = harness({
      commandResults: [releasePr, mismatchedCommit],
    });

    await expect(runReleaseRefiner(testHarness.input)).rejects.toThrow(
      "does not match the remote refiner commit and PR body",
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

  test("withholds CI and inference credentials from tool subprocesses", () => {
    const environment = refinerSdkEnv(
      gitAuth,
      {},
      {
        PATH: "/usr/bin",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        BUILDKITE_AGENT_ACCESS_TOKEN: "agent-token",
        CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
        OPENAI_API_KEY: "openai-key",
      },
    );

    expect(environment).toEqual({
      PATH: "/usr/bin",
      GH_TOKEN: "minted-token",
      GIT_ASKPASS: "/tmp/git-askpass.sh",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  test("keeps the process, TLS, and proxy settings Codex needs", () => {
    expect(
      refinerSdkEnv(
        gitAuth,
        {},
        {
          PATH: "/opt/mise/shims:/usr/bin",
          HOME: "/root",
          NODE_EXTRA_CA_CERTS: "/etc/ssl/ci.pem",
          HTTPS_PROXY: "http://proxy:3128",
          NO_PROXY: "localhost",
        },
      ),
    ).toMatchObject({
      PATH: "/opt/mise/shims:/usr/bin",
      HOME: "/root",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/ci.pem",
      HTTPS_PROXY: "http://proxy:3128",
      NO_PROXY: "localhost",
    });
  });
});
