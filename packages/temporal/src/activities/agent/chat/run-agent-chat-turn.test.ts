import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { runAgentTurn } from "#lib/agent-runner/run.ts";
import type { RunAgentChatTurnInput } from "#shared/agent/agent-chat.ts";
import { runAgentChatTurnWithDependencies } from "./run-agent-chat-turn.ts";
import {
  memoryAgentChatStore,
  temporaryDirectoryTracker,
} from "./test-support.ts";

const temporaryDirectories = temporaryDirectoryTracker("agent-chat-turn-test-");
const providerMustNotRun: typeof runAgentTurn = () =>
  Promise.reject(new Error("provider must not run"));

function codexAuthEnvironment(): Record<string, string> {
  return {
    CODEX_AUTH_JSON_B64: Buffer.from(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: "test-token" },
      }),
    ).toString("base64"),
  };
}

function codexTurnInput(chatId: string, turnId: string): RunAgentChatTurnInput {
  return {
    config: {
      chatId,
      title: "Checkpoint recovery",
      provider: "codex",
      model: "gpt-5.4",
      origin: { kind: "schedule", scheduleId: "checkpoint-test" },
      createdAt: "2026-09-14T20:00:00.000Z",
      maxTurnsPerMessage: 8,
    },
    request: {
      turnId,
      prompt: "checkpoint safely",
      submittedAt: "2026-09-14T20:01:00.000Z",
      source: { kind: "schedule", scheduleId: "checkpoint-test" },
    },
    turnNumber: 1,
  };
}

const successfulCodexProvider: typeof runAgentTurn = async (input) => {
  const codexHome = input.env["CODEX_HOME"];
  if (codexHome === undefined) throw new Error("CODEX_HOME missing");
  await mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await Bun.write(
    path.join(codexHome, "sessions", "checkpoint.jsonl"),
    "durable session",
  );
  return {
    finalText: "checkpointed",
    evidenceEvents: [],
    sessionId: "checkpoint-session",
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
    numTurns: 1,
    generationStarted: true,
    possiblyAppliedEffects: false,
    durationMs: 1,
    eventCount: 1,
    firstEventLatencyMs: 1,
    maxIdleMs: 1,
  };
};

function providerMustNotRunDependencies(
  baseDirectory: string,
  now: () => Date,
) {
  return {
    store: memoryAgentChatStore(),
    bundlePrefix: "agent-chats",
    baseDirectory,
    sourceEnv: {},
    signal: new AbortController().signal,
    redactTokens: [],
    forbiddenSessionTokens: [],
    beforeEvent: () => Promise.resolve(true),
    heartbeat: vi.fn(),
    attempt: 1,
    now,
    runTurn: providerMustNotRun,
    terminateProviderSubprocesses: () => Promise.resolve(),
    onProviderAdmission: vi.fn(),
  };
}

afterEach(async () => {
  await temporaryDirectories.cleanup();
});

describe("runAgentChatTurnWithDependencies", () => {
  test("rejects expired work before preparing or invoking the provider", async () => {
    const baseDirectory = await temporaryDirectories.create();

    await expect(
      runAgentChatTurnWithDependencies(
        {
          config: {
            chatId: "expired-chat",
            title: "Expired chat",
            provider: "codex",
            model: "gpt-5.4",
            origin: { kind: "schedule", scheduleId: "expired-schedule" },
            createdAt: "2026-09-14T20:00:00.000Z",
            maxTurnsPerMessage: 8,
          },
          request: {
            turnId: "expired-turn",
            prompt: "do not run",
            submittedAt: "2026-09-14T20:01:00.000Z",
            providerStartDeadline: "2026-09-14T20:02:00.000Z",
            source: { kind: "schedule", scheduleId: "expired-schedule" },
          },
          turnNumber: 1,
        },
        providerMustNotRunDependencies(
          baseDirectory,
          () => new Date("2026-09-14T20:03:00.000Z"),
        ),
      ),
    ).rejects.toThrow("provider admission deadline");
    expect(
      await Array.fromAsync(new Bun.Glob("**/*").scan(baseDirectory)),
    ).toEqual([]);
  });

  test.each([false, true])(
    "hydrates fresh workspaces and rejects leaked provider auth (%s)",
    async (leakCredential) => {
      const baseDirectory = await temporaryDirectories.create();
      const store = memoryAgentChatStore();
      const resumes: (string | undefined)[] = [];
      const codexPathOverrides: (string | undefined)[] = [];
      const workspaceWasFresh: boolean[] = [];
      const mockedRunTurn: typeof runAgentTurn = async (input) => {
        resumes.push(input.resumeSessionId);
        if (input.provider === "codex") {
          codexPathOverrides.push(input.codexPathOverride);
        }
        workspaceWasFresh.push(
          !(await Bun.file(path.join(input.cwd, "turn-marker")).exists()),
        );
        await Bun.write(path.join(input.cwd, "turn-marker"), "not durable");
        const codexHome = input.env["CODEX_HOME"];
        if (codexHome === undefined) throw new Error("CODEX_HOME missing");
        await mkdir(path.join(codexHome, "sessions"), { recursive: true });
        await Bun.write(
          path.join(codexHome, "sessions", "thread.jsonl"),
          leakCredential
            ? "tool output: test-provider-access-token"
            : `session:${input.resumeSessionId ?? "new"}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 12));
        return {
          finalText: input.resumeSessionId === undefined ? "first" : "second",
          evidenceEvents: [],
          sessionId: "provider-session-1",
          usage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 1,
            reasoningTokens: 0,
          },
          numTurns: 1,
          generationStarted: true,
          possiblyAppliedEffects: false,
          durationMs: 1,
          eventCount: 1,
          firstEventLatencyMs: 1,
          maxIdleMs: 1,
        };
      };
      const config = {
        chatId: "chat-1",
        title: "Test chat",
        provider: "codex" as const,
        model: "gpt-5.4",
        origin: { kind: "schedule" as const, scheduleId: "daily-test" },
        createdAt: "2026-09-14T20:00:00.000Z",
        maxTurnsPerMessage: 8,
      };
      const heartbeat = vi.fn();
      const commonDependencies = {
        store,
        bundlePrefix: "agent-chats",
        baseDirectory,
        sourceEnv: {
          PATH: "/usr/bin",
          CODEX_AUTH_JSON_B64: Buffer.from(
            JSON.stringify({
              auth_mode: "chatgpt",
              tokens: { access_token: "test-provider-access-token" },
            }),
          ).toString("base64"),
        },
        signal: new AbortController().signal,
        redactTokens: [],
        forbiddenSessionTokens: [],
        beforeEvent: async () => true,
        heartbeat,
        heartbeatIntervalMs: 5,
        attempt: 1,
        now: () => new Date("2026-09-14T20:05:00.000Z"),
        runTurn: mockedRunTurn,
        terminateProviderSubprocesses: () => Promise.resolve(),
        onProviderAdmission: vi.fn(),
      };

      const firstTurn = runAgentChatTurnWithDependencies(
        {
          config,
          request: {
            turnId: "message-1",
            prompt: "first",
            submittedAt: "2026-09-14T20:01:00.000Z",
            source: { kind: "discord", channelId: "channel-1" },
          },
          turnNumber: 1,
        },
        commonDependencies,
      );
      if (leakCredential) {
        await expect(firstTurn).rejects.toThrow("credential");
        expect([...store.objects.keys()]).toEqual([
          expect.stringContaining("/provider-admitted"),
        ]);
        return;
      }
      const first = await firstTurn;
      const recovered = await runAgentChatTurnWithDependencies(
        {
          config,
          request: {
            turnId: "message-1",
            prompt: "first",
            submittedAt: "2026-09-14T20:01:00.000Z",
            source: { kind: "discord", channelId: "channel-1" },
          },
          turnNumber: 1,
        },
        {
          ...commonDependencies,
          attempt: 2,
          runTurn: providerMustNotRun,
        },
      );
      expect(recovered).toEqual(first);
      const second = await runAgentChatTurnWithDependencies(
        {
          config,
          request: {
            turnId: "message-2",
            prompt: "second",
            submittedAt: "2026-09-14T20:02:00.000Z",
            source: { kind: "imessage", conversationId: "conversation-1" },
          },
          turnNumber: 2,
          providerSessionId: first.providerSessionId,
          priorSessionManifestKey: first.sessionManifestKey,
        },
        commonDependencies,
      );

      expect(second.finalText).toBe("second");
      expect(second.sessionManifestKey).toContain("/turns/2/attempts/");
      expect(resumes).toEqual([undefined, "provider-session-1"]);
      expect(codexPathOverrides).toEqual([undefined, undefined]);
      expect(workspaceWasFresh).toEqual([true, true]);
      expect(heartbeat.mock.calls.length).toBeGreaterThan(6);
      expect(
        [...store.objects.keys()].some((key) => key.endsWith("auth.json")),
      ).toBe(false);
      expect(
        [...store.objects.keys()].some((key) => key.includes("turn-marker")),
      ).toBe(false);
    },
  );
});

describe("agent chat provider admission boundaries", () => {
  test("rejects cancellation before creating the provider admission marker", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const controller = new AbortController();
    controller.abort(new Error("cancelled during preparation"));
    const dependencies = {
      ...providerMustNotRunDependencies(
        baseDirectory,
        () => new Date("2026-09-14T20:01:00.000Z"),
      ),
      store,
      signal: controller.signal,
    };

    await expect(
      runAgentChatTurnWithDependencies(
        codexTurnInput("cancelled-before-admission", "cancelled-turn"),
        dependencies,
      ),
    ).rejects.toThrow("cancelled during preparation");
    expect(store.objects.size).toBe(0);
    expect(dependencies.onProviderAdmission).not.toHaveBeenCalled();
  });

  test("releases admission when cancellation arrives with its acknowledgment", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const controller = new AbortController();
    const create = store.create;
    store.create = async (key, body) => {
      const created = await create(key, body);
      controller.abort(new Error("cancelled with admission acknowledgment"));
      return created;
    };
    const input = codexTurnInput(
      "cancelled-after-admission",
      "cancelled-admission-turn",
    );

    await expect(
      runAgentChatTurnWithDependencies(input, {
        ...providerMustNotRunDependencies(
          baseDirectory,
          () => new Date("2026-09-14T20:01:00.000Z"),
        ),
        store,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled with admission acknowledgment");
    expect(store.objects.size).toBe(0);

    store.create = create;
    await expect(
      runAgentChatTurnWithDependencies(input, {
        ...providerMustNotRunDependencies(
          baseDirectory,
          () => new Date("2026-09-14T20:01:00.000Z"),
        ),
        store,
        sourceEnv: codexAuthEnvironment(),
        attempt: 2,
        runTurn: successfulCodexProvider,
      }),
    ).resolves.toMatchObject({ finalText: "checkpointed" });
  });

  test("rechecks provider admission after runtime preparation", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const times = [
      new Date("2026-09-14T20:01:00.000Z"),
      new Date("2026-09-14T20:03:00.000Z"),
    ];
    const onProviderAdmission = vi.fn();

    await expect(
      runAgentChatTurnWithDependencies(
        {
          config: {
            chatId: "deadline-during-preparation",
            title: "Deadline during preparation",
            provider: "codex",
            model: "gpt-5.4",
            origin: { kind: "schedule", scheduleId: "deadline-test" },
            createdAt: "2026-09-14T20:00:00.000Z",
            maxTurnsPerMessage: 8,
          },
          request: {
            turnId: "deadline-turn",
            prompt: "do not run",
            submittedAt: "2026-09-14T20:00:00.000Z",
            providerStartDeadline: "2026-09-14T20:02:00.000Z",
            source: { kind: "schedule", scheduleId: "deadline-test" },
          },
          turnNumber: 1,
        },
        {
          ...providerMustNotRunDependencies(
            baseDirectory,
            () => times.shift() ?? new Date("2026-09-14T20:03:00.000Z"),
          ),
          onProviderAdmission,
        },
      ),
    ).rejects.toMatchObject({
      type: "AgentChatTurnExpired",
      nonRetryable: true,
    });
    expect(onProviderAdmission).not.toHaveBeenCalled();
  });

  test("allows a retry when the prior attempt failed before provider admission", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const provider = vi.fn<typeof runAgentTurn>(async (input) => {
      const codexHome = input.env["CODEX_HOME"];
      if (codexHome === undefined) throw new Error("CODEX_HOME missing");
      await mkdir(path.join(codexHome, "sessions"), { recursive: true });
      await Bun.write(
        path.join(codexHome, "sessions", "retry.jsonl"),
        "retry session",
      );
      return {
        finalText: "retried safely",
        evidenceEvents: [],
        sessionId: "retry-session",
        usage: {
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
        },
        numTurns: 1,
        generationStarted: true,
        possiblyAppliedEffects: false,
        durationMs: 1,
        eventCount: 1,
        firstEventLatencyMs: 1,
        maxIdleMs: 1,
      };
    });

    await expect(
      runAgentChatTurnWithDependencies(
        {
          config: {
            chatId: "safe-retry",
            title: "Safe retry",
            provider: "codex",
            model: "gpt-5.4",
            origin: { kind: "schedule", scheduleId: "retry-test" },
            createdAt: "2026-09-14T20:00:00.000Z",
            maxTurnsPerMessage: 8,
          },
          request: {
            turnId: "safe-retry-turn",
            prompt: "retry",
            submittedAt: "2026-09-14T20:01:00.000Z",
            source: { kind: "schedule", scheduleId: "retry-test" },
          },
          turnNumber: 1,
        },
        {
          ...providerMustNotRunDependencies(
            baseDirectory,
            () => new Date("2026-09-14T20:01:00.000Z"),
          ),
          sourceEnv: codexAuthEnvironment(),
          attempt: 2,
          runTurn: provider,
        },
      ),
    ).resolves.toMatchObject({ finalText: "retried safely" });
    expect(provider).toHaveBeenCalledOnce();
  });
});

describe("agent chat provider admission races", () => {
  test("admits only one of two overlapping activity attempts", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const provider = vi.fn<typeof runAgentTurn>(() =>
      Promise.reject(new Error("provider result lost")),
    );
    const input = {
      config: {
        chatId: "overlapping-attempts",
        title: "Overlapping attempts",
        provider: "codex" as const,
        model: "gpt-5.4",
        origin: { kind: "schedule" as const, scheduleId: "race-test" },
        createdAt: "2026-09-14T20:00:00.000Z",
        maxTurnsPerMessage: 8,
      },
      request: {
        turnId: "overlapping-turn",
        prompt: "run once",
        submittedAt: "2026-09-14T20:01:00.000Z",
        source: { kind: "schedule" as const, scheduleId: "race-test" },
      },
      turnNumber: 1,
    };
    const dependencies = {
      ...providerMustNotRunDependencies(
        baseDirectory,
        () => new Date("2026-09-14T20:01:00.000Z"),
      ),
      store,
      sourceEnv: codexAuthEnvironment(),
      runTurn: provider,
    };

    const results = await Promise.allSettled([
      runAgentChatTurnWithDependencies(input, dependencies),
      runAgentChatTurnWithDependencies(input, dependencies),
    ]);

    expect(provider).toHaveBeenCalledOnce();
    expect(
      results.some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof Error &&
          result.reason.message.includes("already durably admitted"),
      ),
    ).toBe(true);
  });

  test("rechecks provider admission after publishing the durable claim", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const times = [
      new Date("2026-09-14T20:01:00.000Z"),
      new Date("2026-09-14T20:01:30.000Z"),
      new Date("2026-09-14T20:03:00.000Z"),
    ];
    const dependencies = providerMustNotRunDependencies(
      baseDirectory,
      () => times.shift() ?? new Date("2026-09-14T20:03:00.000Z"),
    );

    await expect(
      runAgentChatTurnWithDependencies(
        {
          config: {
            chatId: "deadline-during-claim",
            title: "Deadline during claim",
            provider: "codex",
            model: "gpt-5.4",
            origin: { kind: "schedule", scheduleId: "deadline-test" },
            createdAt: "2026-09-14T20:00:00.000Z",
            maxTurnsPerMessage: 8,
          },
          request: {
            turnId: "deadline-claim-turn",
            prompt: "do not run",
            submittedAt: "2026-09-14T20:00:00.000Z",
            providerStartDeadline: "2026-09-14T20:02:00.000Z",
            source: { kind: "schedule", scheduleId: "deadline-test" },
          },
          turnNumber: 1,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      type: "AgentChatTurnExpired",
      nonRetryable: true,
    });
    expect(dependencies.onProviderAdmission).toHaveBeenCalledOnce();
  });

  test("removes runtime files when provider process cleanup fails", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const dependencies = providerMustNotRunDependencies(
      baseDirectory,
      () => new Date("2026-09-14T20:01:00.000Z"),
    );
    dependencies.runTurn = vi.fn<typeof runAgentTurn>(() =>
      Promise.reject(new Error("provider failed")),
    );
    dependencies.sourceEnv = codexAuthEnvironment();
    dependencies.terminateProviderSubprocesses = cleanup;

    await expect(
      runAgentChatTurnWithDependencies(
        {
          config: {
            chatId: "cleanup-failure",
            title: "Cleanup failure",
            provider: "codex",
            model: "gpt-5.4",
            origin: { kind: "schedule", scheduleId: "cleanup-test" },
            createdAt: "2026-09-14T20:00:00.000Z",
            maxTurnsPerMessage: 8,
          },
          request: {
            turnId: "cleanup-turn",
            prompt: "fail",
            submittedAt: "2026-09-14T20:01:00.000Z",
            source: { kind: "schedule", scheduleId: "cleanup-test" },
          },
          turnNumber: 1,
        },
        dependencies,
      ),
    ).rejects.toThrow("cleanup failed");
    await expect(
      stat(path.join(baseDirectory, "cleanup-failure")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes stale runtime files when published-result recovery fails", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    store.has = vi.fn(() => Promise.resolve(true));
    store.get = vi.fn(() => Promise.reject(new Error("corrupt manifest")));
    const dependencies = {
      ...providerMustNotRunDependencies(
        baseDirectory,
        () => new Date("2026-09-14T20:01:00.000Z"),
      ),
      store,
    };
    const input = codexTurnInput("recovery-cleanup", "recovery-turn");
    const staleRoot = path.join(baseDirectory, input.config.chatId);
    await mkdir(staleRoot, { recursive: true });
    await Bun.write(path.join(staleRoot, "stale-runtime-file"), "stale");

    await expect(
      runAgentChatTurnWithDependencies(input, dependencies),
    ).rejects.toThrow("corrupt manifest");
    await expect(stat(staleRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("recovers a published result after post-publication cleanup fails", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue()
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("post-publication cleanup failed"));
    const originalPut = store.put;
    store.put = vi.fn(async (key, body) => {
      expect(cleanup).toHaveBeenCalledTimes(2);
      await originalPut(key, body);
    });
    const provider = vi.fn<typeof runAgentTurn>(successfulCodexProvider);
    const dependencies = {
      ...providerMustNotRunDependencies(
        baseDirectory,
        () => new Date("2026-09-14T20:01:00.000Z"),
      ),
      store,
      sourceEnv: codexAuthEnvironment(),
      runTurn: provider,
      terminateProviderSubprocesses: cleanup,
    };
    const input = codexTurnInput("published-cleanup", "published-turn");

    await expect(
      runAgentChatTurnWithDependencies(input, dependencies),
    ).rejects.toMatchObject({
      type: "AgentChatPostPublicationCleanupFailure",
      nonRetryable: false,
    });
    expect(provider).toHaveBeenCalledOnce();

    await expect(
      runAgentChatTurnWithDependencies(input, {
        ...dependencies,
        attempt: 2,
        runTurn: providerMustNotRun,
      }),
    ).resolves.toMatchObject({ finalText: "checkpointed" });
    expect(provider).toHaveBeenCalledOnce();
  });
});

describe("agent chat provider admission recovery", () => {
  test("refuses a retry after durable provider admission without publication", async () => {
    const baseDirectory = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const input = {
      config: {
        chatId: "ambiguous-retry",
        title: "Ambiguous retry",
        provider: "codex" as const,
        model: "gpt-5.4",
        origin: { kind: "schedule" as const, scheduleId: "retry-test" },
        createdAt: "2026-09-14T20:00:00.000Z",
        maxTurnsPerMessage: 8,
      },
      request: {
        turnId: "ambiguous-retry-turn",
        prompt: "run once",
        submittedAt: "2026-09-14T20:01:00.000Z",
        source: { kind: "schedule" as const, scheduleId: "retry-test" },
      },
      turnNumber: 1,
    };
    const sourceEnv = {
      CODEX_AUTH_JSON_B64: Buffer.from(
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { access_token: "test-token" },
        }),
      ).toString("base64"),
    };
    const firstProvider = vi.fn<typeof runAgentTurn>(() =>
      Promise.reject(new Error("provider result lost")),
    );
    const dependencies = {
      store,
      bundlePrefix: "agent-chats",
      baseDirectory,
      sourceEnv,
      signal: new AbortController().signal,
      redactTokens: [],
      forbiddenSessionTokens: [],
      beforeEvent: () => Promise.resolve(true),
      heartbeat: vi.fn(),
      attempt: 1,
      now: () => new Date("2026-09-14T20:01:00.000Z"),
      runTurn: firstProvider,
      terminateProviderSubprocesses: () => Promise.resolve(),
      onProviderAdmission: vi.fn(),
    };

    await expect(
      runAgentChatTurnWithDependencies(input, dependencies),
    ).rejects.toThrow("provider result lost");
    expect(firstProvider).toHaveBeenCalledOnce();

    await expect(
      runAgentChatTurnWithDependencies(input, {
        ...dependencies,
        attempt: 2,
        runTurn: providerMustNotRun,
      }),
    ).rejects.toMatchObject({
      type: "AgentChatPublicationCheckpointMissing",
      nonRetryable: true,
    });
  });
});
