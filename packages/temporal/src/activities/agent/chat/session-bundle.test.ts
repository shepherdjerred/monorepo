import { afterEach, describe, expect, test } from "vitest";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import {
  agentChatSessionManifestKey,
  pullLatestAgentChatSessionBundle,
  pushAgentChatSessionBundle,
} from "./session-bundle.ts";
import {
  memoryAgentChatStore,
  temporaryDirectoryTracker,
} from "./test-support.ts";
import type { AgentChatObjectStore } from "./session-store.ts";

const temporaryDirectories = temporaryDirectoryTracker(
  "agent-chat-bundle-test-",
);
const TEST_USAGE = {
  inputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
};

afterEach(async () => {
  await temporaryDirectories.cleanup();
});

function turnResult(input: {
  turnId?: string;
  turnNumber?: number;
  providerSessionId?: string;
}) {
  const turnId = input.turnId ?? "turn-1";
  const turnNumber = input.turnNumber ?? 1;
  const providerSessionId = input.providerSessionId ?? "provider-session-1";
  return {
    turnId,
    turnNumber,
    finalText: "done",
    providerSessionId,
    sessionManifestKey: agentChatSessionManifestKey({
      prefix: "agent-chats",
      chatId: "chat-1",
      turnNumber,
      turnId,
    }),
    completedAt: "2026-09-14T20:05:00.000Z",
    usage: TEST_USAGE,
  };
}

async function sessionBundleInput(store: AgentChatObjectStore) {
  const source = await temporaryDirectories.create();
  const sessionDirectory = path.join(source, "codex-home", "sessions");
  await mkdir(sessionDirectory, { recursive: true });
  await Bun.write(path.join(sessionDirectory, "thread.jsonl"), "session data");
  return {
    store,
    prefix: "agent-chats",
    chatId: "chat-1",
    provider: "codex" as const,
    turnNumber: 1,
    turnId: "turn-1",
    providerSessionId: "provider-session-1",
    workspacePath: "/tmp/agent-chats/chat-1/workspace",
    sessionHome: source,
    forbiddenTokens: [],
    turnResult: turnResult({}),
  };
}

describe("agent chat session bundles", () => {
  test("round trips only the provider session slice", async () => {
    const source = await temporaryDirectories.create();
    const destination = await temporaryDirectories.create();
    const sessionFile = path.join(
      source,
      "codex-home",
      "sessions",
      "2026",
      "thread.jsonl",
    );
    await mkdir(path.join(source, "codex-home", "sessions", "2026"), {
      recursive: true,
    });
    await Bun.write(sessionFile, "session data");
    await Bun.write(path.join(source, "codex-home", "auth.json"), "credential");
    const store = memoryAgentChatStore();

    const published = await pushAgentChatSessionBundle({
      store,
      prefix: "agent-chats",
      chatId: "chat-1",
      provider: "codex",
      turnNumber: 1,
      turnId: "turn-1",
      providerSessionId: "provider-session-1",
      workspacePath: "/tmp/agent-chats/chat-1/workspace",
      sessionHome: source,
      forbiddenTokens: [],
      turnResult: turnResult({}),
    });
    await pullLatestAgentChatSessionBundle({
      store,
      prefix: "agent-chats",
      chatId: "chat-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      manifestKey: published.manifestKey,
      expectedTurnNumber: 1,
      workspacePath: "/tmp/agent-chats/chat-1/workspace",
      sessionHome: destination,
    });

    expect(published.manifest.files.map((file) => file.path)).toEqual([
      "codex-home/sessions/2026/thread.jsonl",
    ]);
    expect(
      await Bun.file(
        path.join(
          destination,
          "codex-home",
          "sessions",
          "2026",
          "thread.jsonl",
        ),
      ).text(),
    ).toBe("session data");
    expect(
      await Bun.file(
        path.join(destination, "codex-home", "auth.json"),
      ).exists(),
    ).toBe(false);
  });

  test("rejects a manifest path that escapes the session home", async () => {
    const destination = await temporaryDirectories.create();
    const store = memoryAgentChatStore();
    const turnId = "turn-1";
    const turnHash = new Bun.CryptoHasher("sha256")
      .update(new TextEncoder().encode(turnId))
      .digest("hex");
    const turnRoot = `agent-chats/sessions/chat-1/turns/1/attempts/${turnHash}`;
    const manifestKey = `${turnRoot}/manifest.json`;
    await store.put(
      manifestKey,
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 2,
          chatId: "chat-1",
          provider: "codex",
          turnNumber: 1,
          turnId,
          providerSessionId: "provider-session-1",
          workspacePath: "/tmp/agent-chats/chat-1/workspace",
          files: [
            {
              path: "../escaped",
              bytes: 1,
              sha256:
                "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
              chunks: [
                {
                  key: "agent-chats/sessions/chat-1/blobs/ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
                  bytes: 1,
                  sha256:
                    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
                },
              ],
            },
          ],
        }),
      ),
    );
    await store.put(
      `${turnRoot}/files/../escaped`,
      new TextEncoder().encode("a"),
    );

    await expect(
      pullLatestAgentChatSessionBundle({
        store,
        prefix: "agent-chats",
        chatId: "chat-1",
        provider: "codex",
        providerSessionId: "provider-session-1",
        manifestKey,
        expectedTurnNumber: 1,
        workspacePath: "/tmp/agent-chats/chat-1/workspace",
        sessionHome: destination,
      }),
    ).rejects.toThrow("escapes session home");
  });

  test("rejects symlinked provider state before it reaches object storage", async () => {
    const source = await temporaryDirectories.create();
    const outside = await temporaryDirectories.create();
    const codexHome = path.join(source, "codex-home");
    const outsideSecret = path.join(outside, "service-account-token");
    await mkdir(codexHome, { recursive: true });
    await Bun.write(outsideSecret, "host credential");
    await symlink(outsideSecret, path.join(codexHome, "history.jsonl"));

    await expect(
      pushAgentChatSessionBundle({
        store: memoryAgentChatStore(),
        prefix: "agent-chats",
        chatId: "chat-1",
        provider: "codex",
        turnNumber: 1,
        turnId: "turn-1",
        providerSessionId: "provider-session-1",
        workspacePath: "/tmp/agent-chats/chat-1/workspace",
        sessionHome: source,
        forbiddenTokens: [],
        turnResult: turnResult({}),
      }),
    ).rejects.toThrow("symbolic link");
  });

  test("rejects mounted credentials before provider state reaches storage", async () => {
    const source = await temporaryDirectories.create();
    const sessionDirectory = path.join(source, "codex-home", "sessions");
    await mkdir(sessionDirectory, { recursive: true });
    await Bun.write(
      path.join(sessionDirectory, "thread.jsonl"),
      '{"output":"mounted-service-account-token"}',
    );
    const store = memoryAgentChatStore();

    await expect(
      pushAgentChatSessionBundle({
        store,
        prefix: "agent-chats",
        chatId: "chat-1",
        provider: "codex",
        turnNumber: 1,
        turnId: "turn-1",
        providerSessionId: "provider-session-1",
        workspacePath: "/tmp/agent-chats/chat-1/workspace",
        sessionHome: source,
        forbiddenTokens: ["mounted-service-account-token"],
        turnResult: turnResult({}),
      }),
    ).rejects.toThrow("contains a mounted credential");
    expect(store.objects.size).toBe(0);
  });
});

describe("agent chat session bundle publication", () => {
  test("preserves chunks when a committed manifest acknowledgement is lost", async () => {
    const backingStore = memoryAgentChatStore();
    const store = {
      ...backingStore,
      put: async (key: string, body: Uint8Array) => {
        await backingStore.put(key, body);
        if (key.endsWith("/manifest.json")) {
          throw new Error("manifest acknowledgement lost");
        }
      },
    };

    const published = await pushAgentChatSessionBundle(
      await sessionBundleInput(store),
    );

    expect(backingStore.objects.has(published.manifestKey)).toBe(true);
    expect(backingStore.objects.size).toBe(2);
  });

  test("removes newly created chunks when manifest publication fails", async () => {
    const backingStore = memoryAgentChatStore();
    const store = {
      ...backingStore,
      put: async (key: string, body: Uint8Array) => {
        if (key.endsWith("/manifest.json")) {
          throw new Error("manifest publication failed");
        }
        await backingStore.put(key, body);
      },
    };

    await expect(
      sessionBundleInput(store).then(pushAgentChatSessionBundle),
    ).rejects.toThrow("manifest publication failed");
    expect(backingStore.objects.size).toBe(0);
  });
});
