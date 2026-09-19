import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { runAgentTurn } from "#lib/agent-runner/run.ts";
import { runAgentChatTurnWithDependencies } from "./run-agent-chat-turn.ts";
import {
  memoryAgentChatStore,
  temporaryDirectoryTracker,
} from "./test-support.ts";

const temporaryDirectories = temporaryDirectoryTracker("agent-chat-turn-test-");
const providerMustNotRun: typeof runAgentTurn = () =>
  Promise.reject(new Error("provider must not run"));

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
        {
          store: memoryAgentChatStore(),
          bundlePrefix: "agent-chats",
          baseDirectory,
          sourceEnv: {},
          signal: new AbortController().signal,
          redactTokens: [],
          forbiddenSessionTokens: [],
          beforeEvent: () => Promise.resolve(true),
          heartbeat: vi.fn(),
          now: () => new Date("2026-09-14T20:03:00.000Z"),
          runTurn: providerMustNotRun,
        },
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
        now: () => new Date("2026-09-14T20:05:00.000Z"),
        runTurn: mockedRunTurn,
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
        expect(store.objects.size).toBe(0);
        return;
      }
      const first = await firstTurn;
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
