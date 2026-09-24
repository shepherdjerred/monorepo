import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod/v4";
import type * as SubscriptionAdapter from "./codex-app-server/turn.ts";

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  resumeThread: vi.fn(),
  startThread: vi.fn(),
  createOpenRouterConfig: vi.fn(),
  prepareProviderWorkspace: vi.fn(),
  restoreProviderWorkspace: vi.fn(),
  finishParser: vi.fn(),
  subscriptionEvents: vi.fn(),
}));
vi.mock("./codex-app-server/turn.ts", async (importOriginal) => {
  const original = await importOriginal<typeof SubscriptionAdapter>();
  return { ...original, runSubscriptionCodexEvents: mocks.subscriptionEvents };
});

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
  createCodexConfig: mocks.createOpenRouterConfig,
}));
vi.mock("./provider-workspace.ts", () => ({
  prepareProviderWorkspace: mocks.prepareProviderWorkspace,
  restoreProviderWorkspace: mocks.restoreProviderWorkspace,
}));
vi.mock("@shepherdjerred/llm-observability/codex-jsonl", () => ({
  createCodexJsonlParser: () => ({
    push: vi.fn(),
    finish: mocks.finishParser,
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
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resumeThread.mockReturnValue({
    runStreamed: () => Promise.resolve({ events: streamedEvents() }),
  });
  mocks.subscriptionEvents.mockImplementation(() => streamedEvents());
});
afterEach(() => vi.unstubAllEnvs());

async function withLifecycleDirectory(
  name: string,
  action: (input: { directory: string; codexHome: string }) => Promise<void>,
): Promise<void> {
  const directory = path.join(os.tmpdir(), `${name}-${crypto.randomUUID()}`);
  const codexHome = path.join(directory, "home");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await action({ directory, codexHome });
    const restored = await stat(directory);
    expect(restored.mode & 0o777).toBe(0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("runCodexAgentTurn failure classification", () => {
  test("never materializes subscription credentials in the provider home", async () => {
    mocks.subscriptionEvents.mockImplementation((input: unknown) => {
      const parsed = z
        .object({ environment: z.object({ CODEX_HOME: z.string() }) })
        .parse(input);
      return (async function* () {
        expect(
          await Bun.file(
            path.join(parsed.environment.CODEX_HOME, "auth.json"),
          ).exists(),
        ).toBe(false);
        yield* streamedEvents();
      })();
    });
    await runSubscriptionTurn();
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  test("workspace restoration failures retain generation classification", async () => {
    mocks.restoreProviderWorkspace.mockRejectedValue(
      new Error("restore failed"),
    );
    await expect(runSubscriptionTurn()).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      message: expect.stringContaining("restore failed"),
    });
  });
  test.each([
    { type: "turn.failed", error: { message: "failed with codex-secret" } },
    { type: "error", message: "failed with codex-secret" },
  ])("redacts terminal provider failures before propagation", async (event) => {
    mocks.subscriptionEvents.mockReturnValue(
      (async function* () {
        yield event;
      })(),
    );

    const failure = runSubscriptionTurn();
    await expect(failure).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      message: expect.stringContaining("failed with ***"),
    });
    await expect(failure).rejects.not.toThrow("codex-secret");
  });
  test("cleanup failures retain billed generation classification", async () => {
    mocks.finishParser.mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    await expect(runSubscriptionTurn()).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      possiblyAppliedEffects: false,
      message: expect.stringContaining("cleanup failed"),
    });
  });

  test("refresh failures classify the raw effectful event before tracing", async () => {
    mocks.subscriptionEvents.mockReturnValue(
      (async function* () {
        yield {
          type: "item.started",
          item: {
            id: "command",
            type: "command_execution",
            command: "touch result",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        };
      })(),
    );
    await expect(
      runSubscriptionTurn(() => Promise.resolve(false)),
    ).rejects.toMatchObject({
      name: "AgentTurnExecutionError",
      generationStarted: true,
      possiblyAppliedEffects: true,
    });
  });

  test("redacts credentials added during a stream refresh", async () => {
    const redactTokens = ["codex-secret"];
    mocks.subscriptionEvents.mockReturnValue(
      (async function* () {
        yield {
          type: "item.completed",
          item: {
            id: "message",
            type: "agent_message",
            text: "done rotated-secret",
          },
        };
      })(),
    );

    const outcome = await runSubscriptionTurn(
      () => {
        redactTokens.push("rotated-secret");
        return Promise.resolve(true);
      },
      undefined,
      redactTokens,
    );

    expect(outcome.finalText).toBe("done ***");
  });
});

describe("runCodexAgentTurn preparation", () => {
  test("uses a persistent OpenRouter home for an initial session", async () => {
    vi.stubEnv("AGENT_PROVIDER_UID", "1001");
    let expectedCodexHome = "";
    mocks.createOpenRouterConfig.mockImplementation((input: unknown) => {
      const parsed = z
        .object({ env: z.record(z.string(), z.string()) })
        .parse(input);
      expect(parsed.env["HOME"]).toBe(expectedCodexHome);
      expect(parsed.env["CODEX_HOME"]).toBe(expectedCodexHome);
      throw new Error("OpenRouter setup failed");
    });

    await withLifecycleDirectory(
      "codex-openrouter-lifecycle",
      async ({ codexHome }) => {
        expectedCodexHome = codexHome;
        await expect(
          runCodexAgentTurn({
            service: "temporal",
            callSite: "agent-chat",
            prompt: "continue",
            model: "openrouter/model",
            maxTurns: 4,
            turnBudgetKind: "turns",
            cwd: "/work/session",
            auth: { kind: "openrouter", apiKey: "openrouter-secret" },
            env: { CODEX_HOME: codexHome },
            signal: new AbortController().signal,
            sandboxPolicy: {
              sandboxMode: "danger-full-access",
              networkAccessEnabled: true,
              webSearchMode: "live",
            },
            beforeEvent: () => Promise.resolve(true),
            onEvent: vi.fn(),
          }),
        ).rejects.toMatchObject({ name: "AgentTurnExecutionError" });
      },
    );
  });

  test("rolls back subscription preparation when launcher setup fails", async () => {
    vi.stubEnv("AGENT_PROVIDER_UID", "1001");
    await withLifecycleDirectory("codex-runner-lifecycle", async (input) => {
      const invalidTemporaryDirectory = path.join(
        input.directory,
        "not-a-directory",
      );
      await chmod(input.directory, 0o700);
      await writeFile(invalidTemporaryDirectory, "file");
      vi.stubEnv("TMPDIR", invalidTemporaryDirectory);
      await expect(
        runCodexAgentTurn({
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
              tokens: {
                access_token: "test-token",
                account_id: "test-account",
              },
            }),
          },
          env: { CODEX_HOME: input.codexHome },
          signal: new AbortController().signal,
          sandboxPolicy: {
            sandboxMode: "danger-full-access",
            networkAccessEnabled: true,
            webSearchMode: "live",
          },
          beforeEvent: () => Promise.resolve(true),
          onEvent: vi.fn(),
        }),
      ).rejects.toMatchObject({ name: "AgentTurnExecutionError" });
    });
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
          tokens: {
            access_token: "explicit-access-token",
            account_id: "test-account",
          },
        }),
      },
      env: {
        PATH: "/bin",
        CODEX_HOME: codexHome,
        CODEX_ACCESS_TOKEN: "must-not-forward",
        GEMINI_API_KEY: "must-not-forward",
        GOOGLE_GENERATIVE_AI_API_KEY: "must-not-forward",
        GROQ_API_KEY: "must-not-forward",
        OPENAI_API_KEY: "must-not-forward",
        OPENROUTER_API_KEY: "must-not-forward-either",
        XAI_API_KEY: "must-not-forward",
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
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.subscriptionEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        authJson: expect.stringContaining("explicit-access-token"),
        environment: {
          PATH: "/bin",
          HOME: codexHome,
          CODEX_HOME: codexHome,
        },
      }),
    );
    expect(await Bun.file(path.join(codexHome, "auth.json")).exists()).toBe(
      false,
    );
    await rm(codexHome, { recursive: true, force: true });
    expect(mocks.subscriptionEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          model: "gpt-5.4",
          cwd: "/work/session",
          resumeSessionId: "codex-session",
          skipGitRepoCheck: true,
        }),
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
    let providerHome = "";
    mocks.createOpenRouterConfig.mockImplementation((input: unknown) => {
      const parsed = z
        .object({ env: z.record(z.string(), z.string()) })
        .parse(input);
      providerHome = z.string().parse(parsed.env["HOME"]);
      expect(providerHome).not.toBe("/root");
      expect(parsed.env["CODEX_HOME"]).toBe(path.join(providerHome, ".codex"));
      return {
        codexOptions: { env: parsed.env },
        routeModelId: "openrouter/model",
      };
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
    vi.stubEnv("AGENT_PROVIDER_UID", "1001");

    await runCodexAgentTurn({
      service: "temporal",
      callSite: "agent-chat",
      prompt: "start",
      model: "openrouter/model",
      maxTurns: 4,
      turnBudgetKind: "turns",
      cwd: "/work/session",
      auth: { kind: "openrouter", apiKey: "openrouter-secret" },
      env: { PATH: "/bin", HOME: "/root" },
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
    expect(mocks.prepareProviderWorkspace).toHaveBeenCalledWith(
      "/work/session",
      1001,
    );
    expect(mocks.prepareProviderWorkspace).toHaveBeenCalledWith(
      providerHome,
      1001,
    );
    expect(
      await Bun.file(path.join(providerHome, ".codex", "auth.json")).exists(),
    ).toBe(false);
    expect(await Bun.file(providerHome).exists()).toBe(false);
  });
});

async function runSubscriptionTurn(
  beforeEvent = () => Promise.resolve(true),
  afterRun?: () => Promise<void>,
  redactTokens: string[] = ["codex-secret"],
) {
  const codexHome = path.join(
    os.tmpdir(),
    `codex-runner-test-${crypto.randomUUID()}`,
  );
  try {
    const result = await runCodexAgentTurn({
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
          tokens: { access_token: "test-token", account_id: "test-account" },
        }),
      },
      env: { CODEX_HOME: codexHome },
      signal: new AbortController().signal,
      sandboxPolicy: {
        sandboxMode: "danger-full-access",
        networkAccessEnabled: true,
        webSearchMode: "live",
      },
      resumeSessionId: "codex-session",
      redactTokens,
      beforeEvent,
      onEvent: vi.fn(),
    });
    await afterRun?.();
    return result;
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
}

function shellQuoteForTest(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
