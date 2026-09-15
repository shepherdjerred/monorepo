import { beforeEach, describe, expect, test, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const tracedMessages = vi.hoisted((): unknown[] => []);

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));
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

function input() {
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
    redactTokens: ["oauth-secret"],
    beforeEvent: () => Promise.resolve(true),
    onEvent: vi.fn(),
  };
}

beforeEach(() => {
  queryMock.mockReset();
  tracedMessages.length = 0;
});

describe("runClaudeAgentTurn", () => {
  test("resumes a subscription session and normalizes its result", async () => {
    queryMock.mockReturnValue(successfulMessages());

    const outcome = await runClaudeAgentTurn(input());

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
    queryMock.mockReturnValue(
      (async function* () {
        yield {
          type: "assistant",
          session_id: "claude-session",
          message: {
            content: [{ type: "tool_use", name: "Bash", input: {} }],
          },
        };
      })(),
    );

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
});
