import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const tracedMessages = vi.hoisted((): unknown[] => []);
const prepareProviderWorkspaceMock = vi.hoisted(() => vi.fn());
const restoreProviderWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));
vi.mock("./provider-workspace.ts", () => ({
  prepareProviderWorkspace: prepareProviderWorkspaceMock,
  restoreProviderWorkspace: restoreProviderWorkspaceMock,
}));
vi.mock("@shepherdjerred/llm-observability/wrappers/claude-agent", () => ({
  traceClaudeAgent: async function* (
    _metadata: unknown,
    run: () => AsyncIterable<unknown>,
    transform?: (message: unknown) => Promise<unknown>,
  ) {
    for await (const message of run()) {
      const safeMessage =
        transform === undefined ? message : await transform(message);
      tracedMessages.push(safeMessage);
      yield safeMessage;
    }
  },
}));

import { runClaudeAgentTurn } from "./claude.ts";
import { AgentTurnExecutionError } from "./errors.ts";

afterEach(() => vi.unstubAllEnvs());

const USAGE = {
  input_tokens: 11,
  cache_read_input_tokens: 3,
  cache_creation_input_tokens: 2,
  output_tokens: 7,
};

function successfulMessages(): AsyncIterable<unknown> {
  return (async function* () {
    yield {
      type: "system",
      subtype: "init",
      session_id: "claude-session",
    };
    yield {
      type: "assistant",
      session_id: "claude-session",
      message: { content: [{ type: "text", text: "working" }] },
    };
    yield {
      type: "result",
      subtype: "success",
      session_id: "claude-session",
      result: "done oauth-secret",
      num_turns: 2,
      usage: USAGE,
    };
  })();
}

async function* toolUseMessages(): AsyncIterable<unknown> {
  yield {
    type: "assistant",
    session_id: "claude-session",
    message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
  };
}

function input(resumeWorkspacePath: string | null = "/work/session") {
  return {
    service: "temporal",
    callSite: "agent-chat",
    prompt: "continue",
    model: "claude-sonnet-5",
    maxTurns: 4,
    cwd: "/work/session",
    auth: {
      kind: "claude-subscription" as const,
      oauthToken: "oauth-secret",
    },
    env: {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "must-not-forward",
      CLAUDE_CODE_OAUTH_TOKEN: "stale-token",
    },
    signal: new AbortController().signal,
    permissionPolicy: "bypassPermissions" as const,
    resumeSessionId: "claude-session",
    ...(resumeWorkspacePath === null ? {} : { resumeWorkspacePath }),
    redactTokens: ["oauth-secret"],
    beforeEvent: () => Promise.resolve(true),
    onEvent: vi.fn(),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  queryMock.mockReset();
  prepareProviderWorkspaceMock.mockReset();
  restoreProviderWorkspaceMock.mockReset();
  tracedMessages.length = 0;
});

describe("runClaudeAgentTurn", () => {
  test.each([null, "/work/another-session"])(
    "rejects resume with an unverified workspace %s",
    async (resumeWorkspacePath) => {
      await expect(
        runClaudeAgentTurn(input(resumeWorkspacePath)),
      ).rejects.toMatchObject({
        name: "AgentTurnExecutionError",
        generationStarted: false,
        message: expect.stringContaining("original checkpoint workspace path"),
      });
      expect(queryMock).not.toHaveBeenCalled();
    },
  );
  test("workspace restoration failures retain billed classification", async () => {
    queryMock.mockReturnValue(successfulMessages());
    restoreProviderWorkspaceMock.mockRejectedValue(new Error("restore failed"));
    await expect(runClaudeAgentTurn(input())).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      message: expect.stringContaining("restore failed"),
    });
  });
  test("treats a stream failure before first output as an ambiguous submission", async () => {
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          Promise.reject(new Error("connection closed after submission")),
      }),
    });

    await expect(runClaudeAgentTurn(input())).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      message: expect.stringContaining("connection closed after submission"),
    });
  });
  test("resumes a subscription session and normalizes its result", async () => {
    queryMock.mockReturnValue(successfulMessages());

    const outcome = await runClaudeAgentTurn({ ...input(), redactTokens: [] });

    expect(outcome).toMatchObject({
      finalText: "done ***",
      sessionId: "claude-session",
      numTurns: 2,
      usage: {
        inputTokens: 11,
        cachedInputTokens: 3,
        cacheWriteInputTokens: 2,
        outputTokens: 7,
        reasoningTokens: 0,
      },
      generationStarted: true,
      possiblyAppliedEffects: false,
      evidenceEvents: [],
    });
    expect(queryMock).toHaveBeenCalledWith({
      prompt: "continue",
      options: expect.objectContaining({
        cwd: "/work/session",
        resume: "claude-session",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
        },
        settings: {
          sandbox: {
            credentials: {
              envVars: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" }],
            },
          },
        },
        settingSources: [],
        spawnClaudeCodeProcess: expect.any(Function),
        env: {
          PATH: "/bin",
          CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
        },
      }),
    });
    expect(JSON.stringify(tracedMessages)).not.toContain("oauth-secret");
  });

  test("redacts traced tool results and retains them as evidence", async () => {
    queryMock.mockReturnValue(
      (async function* () {
        yield {
          type: "user",
          session_id: "claude-session",
          parent_tool_use_id: "tool-1",
          tool_use_result: { stdout: "oauth-secret" },
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "oauth-secret",
              },
            ],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "claude-session",
          result: "done",
          num_turns: 1,
          usage: USAGE,
        };
      })(),
    );

    const outcome = await runClaudeAgentTurn({
      ...input(),
      captureEvidenceEvents: true,
      redactTokens: [],
    });

    expect(JSON.stringify(tracedMessages)).not.toContain("oauth-secret");
    expect(JSON.stringify(outcome.evidenceEvents)).toContain("***");
    expect(JSON.stringify(outcome.evidenceEvents)).not.toContain(
      "oauth-secret",
    );
  });

  test("classifies a failed turn after tool use as possibly applied", async () => {
    queryMock.mockReturnValue(
      (async function* () {
        yield {
          type: "assistant",
          session_id: "claude-session",
          message: {
            content: [{ type: "tool_use", name: "Bash", input: {} }],
          },
        };
        yield {
          type: "result",
          subtype: "error_during_execution",
          session_id: "claude-session",
          errors: ["command failed"],
          num_turns: 1,
          usage: USAGE,
        };
      })(),
    );

    const failure = runClaudeAgentTurn(input());

    await expect(failure).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      possiblyAppliedEffects: true,
      message: "Claude Agent SDK run failed: command failed",
    });
    await expect(failure).rejects.toBeInstanceOf(AgentTurnExecutionError);
  });

  test("classifies tool use before invoking a fallible event observer", async () => {
    queryMock.mockReturnValue(toolUseMessages());

    const failure = runClaudeAgentTurn({
      ...input(),
      onEvent: () => {
        throw new Error("observer unavailable");
      },
    });

    await expect(failure).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      possiblyAppliedEffects: true,
      message: "Claude Agent SDK run failed: observer unavailable",
    });
  });

  test("classifies generation before a redaction refresh failure", async () => {
    queryMock.mockReturnValue(toolUseMessages());

    const failure = runClaudeAgentTurn({
      ...input(),
      beforeEvent: () => Promise.resolve(false),
    });

    await expect(failure).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      possiblyAppliedEffects: true,
      message: expect.stringContaining("secret redaction refresh failed"),
    });
  });
});

describe("Claude provider home isolation", () => {
  test("uses the worker provider uid for workspace and subprocess isolation", async () => {
    queryMock.mockReturnValue(successfulMessages());
    vi.stubEnv("AGENT_PROVIDER_UID", "1001");

    const home = await mkdtemp(path.join(os.tmpdir(), "claude-runner-home-"));
    try {
      await runClaudeAgentTurn({
        ...input(),
        env: { ...input().env, HOME: home },
      });
      expect(prepareProviderWorkspaceMock).toHaveBeenCalledWith(home, 1001);
      expect(restoreProviderWorkspaceMock).toHaveBeenCalledWith(home);
      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({ HOME: home }),
          }),
        }),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }

    expect(prepareProviderWorkspaceMock).toHaveBeenCalledWith(
      "/work/session",
      1001,
    );
    expect(restoreProviderWorkspaceMock).toHaveBeenCalledWith("/work/session");
  });
  test("rejects a dropped-uid Claude launch without an isolated HOME", async () => {
    vi.stubEnv("AGENT_PROVIDER_UID", "1001");
    await expect(runClaudeAgentTurn(input())).rejects.toMatchObject({
      generationStarted: false,
      message: expect.stringContaining("explicit isolated HOME"),
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
