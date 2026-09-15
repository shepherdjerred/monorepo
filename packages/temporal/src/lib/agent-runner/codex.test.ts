import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod/v4";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  resumeThread: vi.fn(),
  startThread: vi.fn(),
  createOpenRouterConfig: vi.fn(),
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    constructor(options: unknown) {
      mocks.constructor(options);
    }

    startThread(options: unknown): unknown {
      return mocks.startThread(options);
    }

    resumeThread(id: string, options: unknown): unknown {
      return mocks.resumeThread(id, options);
    }
  },
}));
vi.mock("@shepherdjerred/llm-runtime", () => ({
  createOpenRouterCodexConfig: mocks.createOpenRouterConfig,
}));
vi.mock("@shepherdjerred/llm-observability/codex-jsonl", () => ({
  createCodexJsonlParser: () => ({
    push: vi.fn(),
    finish: vi.fn(),
  }),
}));
vi.mock("@shepherdjerred/llm-observability/wrappers/codex", () => ({
  attachCodexTrace: () => ({
    run: (operation: () => unknown) => operation(),
    end: vi.fn(),
  }),
}));

import { runCodexAgentTurn } from "./codex.ts";

function streamedEvents(): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "thread.started", thread_id: "codex-session" };
    yield { type: "turn.started" };
    yield {
      type: "item.completed",
      item: {
        id: "message",
        type: "agent_message",
        text: "done codex-secret",
      },
    };
    yield {
      type: "turn.completed",
      usage: {
        input_tokens: 13,
        cached_input_tokens: 5,
        cache_write_input_tokens: 3,
        output_tokens: 8,
        reasoning_output_tokens: 2,
      },
    };
  })();
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resumeThread.mockReturnValue({
    runStreamed: () => Promise.resolve({ events: streamedEvents() }),
  });
});

describe("runCodexAgentTurn", () => {
  test("resumes with explicit ChatGPT subscription auth hidden from tools", async () => {
    const onEvent = vi.fn();
    const codexHome = path.join(
      os.tmpdir(),
      `codex-runner-test-${crypto.randomUUID()}`,
    );
    const outcome = await runCodexAgentTurn({
      service: "temporal",
      callSite: "agent-chat",
      prompt: "continue",
      model: "gpt-5.4",
      maxTurns: 4,
      turnBudgetKind: "turns",
      cwd: "/work/session",
      auth: {
        kind: "chatgpt-subscription",
        authJson: JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { access_token: "explicit-access-token" },
        }),
      },
      env: {
        PATH: "/bin",
        CODEX_HOME: codexHome,
        CODEX_ACCESS_TOKEN: "must-not-forward",
        OPENROUTER_API_KEY: "must-not-forward-either",
      },
      signal: new AbortController().signal,
      sandboxPolicy: {
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        webSearchMode: "live",
      },
      skipGitRepoCheck: true,
      resumeSessionId: "codex-session",
      redactTokens: ["codex-secret"],
      beforeEvent: () => Promise.resolve(true),
      onEvent,
    });

    expect(mocks.createOpenRouterConfig).not.toHaveBeenCalled();
    expect(mocks.constructor).toHaveBeenCalledWith({
      env: {
        PATH: "/bin",
        CODEX_HOME: codexHome,
      },
      config: {
        allow_login_shell: false,
        shell_environment_policy: {
          inherit: "all",
          ignore_default_excludes: false,
          exclude: [
            "CODEX_ACCESS_TOKEN",
            "CODEX_API_KEY",
            "OPENROUTER_API_KEY",
          ],
          experimental_use_profile: false,
        },
      },
    });
    expect(await Bun.file(path.join(codexHome, "auth.json")).exists()).toBe(
      false,
    );
    await rm(codexHome, { recursive: true, force: true });
    expect(mocks.resumeThread).toHaveBeenCalledWith(
      "codex-session",
      expect.objectContaining({
        model: "gpt-5.4",
        workingDirectory: "/work/session",
        skipGitRepoCheck: true,
      }),
    );
    expect(mocks.startThread).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      finalText: "done ***",
      sessionId: "codex-session",
      numTurns: 1,
      evidenceEvents: [],
      usage: {
        inputTokens: 13,
        cachedInputTokens: 5,
        cacheWriteInputTokens: 3,
        outputTokens: 8,
        reasoningTokens: 2,
      },
    });
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  test("automatically wraps the bundled Codex launcher with the provider uid", async () => {
    let wrapperPath = "";
    let wrapperScript = "";
    mocks.createOpenRouterConfig.mockReturnValue({
      codexOptions: { env: { PATH: "/bin" } },
      routeModelId: "openrouter/model",
    });
    mocks.constructor.mockImplementation((options: unknown) => {
      const parsed = z
        .object({ codexPathOverride: z.string().min(1) })
        .parse(options);
      wrapperPath = parsed.codexPathOverride;
    });
    mocks.startThread.mockReturnValue({
      runStreamed: async () => {
        wrapperScript = await Bun.file(wrapperPath).text();
        return { events: streamedEvents() };
      },
    });

    await runCodexAgentTurn({
      service: "temporal",
      callSite: "agent-chat",
      prompt: "start",
      model: "openrouter/model",
      maxTurns: 4,
      turnBudgetKind: "turns",
      cwd: "/work/session",
      auth: { kind: "openrouter", apiKey: "openrouter-secret" },
      env: { PATH: "/bin", AGENT_PROVIDER_UID: "1001" },
      signal: new AbortController().signal,
      sandboxPolicy: {
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        webSearchMode: "live",
      },
      skipGitRepoCheck: true,
      redactTokens: ["openrouter-secret"],
      beforeEvent: () => Promise.resolve(true),
      onEvent: vi.fn(),
    });

    expect(wrapperScript).toContain("'setpriv' '--reuid=1001' '--'");
    expect(wrapperScript).toContain(shellQuoteForTest(process.execPath));
    expect(wrapperScript).toContain("codex.js");
    expect(await Bun.file(wrapperPath).exists()).toBe(false);
  });
});

function shellQuoteForTest(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
